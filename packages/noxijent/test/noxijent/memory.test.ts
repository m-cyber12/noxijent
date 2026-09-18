import { afterEach, describe, expect, it } from "bun:test"
import { Events, Memory } from "../../src/noxijent"
import { cleanup, rejects, tempdir } from "./helpers"

afterEach(cleanup)

describe("memory", () => {
  it("adds entries with evidence-based default confidence", async () => {
    const repo = await tempdir()
    const entry = await Memory.add(repo, {
      key: "database",
      fact: "The project uses PostgreSQL",
      sources: [{ path: "package.json" }, { path: "docker-compose.yml" }, { path: "prisma/schema.prisma" }],
    })

    expect(entry.confidence).toBe(0.8)
    expect(entry.status).toBe("active")
    expect(entry.sources.length).toBe(3)

    const raw = await Bun.file(Memory.file(repo)).text()
    expect(raw).toContain('"key": "database"')
  })

  it("merges supporting evidence and raises confidence on re-add", async () => {
    const repo = await tempdir()
    await Memory.add(repo, {
      key: "pm",
      fact: "The project uses bun",
      confidence: 0.5,
      sources: [{ path: "bun.lock" }],
    })
    const entry = await Memory.add(repo, {
      key: "pm",
      fact: "The project uses bun",
      sources: [{ path: "package.json" }],
    })

    expect(entry.confidence).toBeCloseTo(0.7, 5)
    expect(entry.sources.map((source) => source.path).sort()).toEqual(["bun.lock", "package.json"])
    expect(entry.history.map((item) => item.action)).toEqual(["added", "confirmed"])
  })

  it("confirms raise confidence with decaying headroom toward 1", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "k", fact: "f", confidence: 0.5 })
    let entry = await Memory.confirm(repo, "k")
    expect(entry.confidence).toBeCloseTo(0.7, 5)
    entry = await Memory.confirm(repo, "k")
    expect(entry.confidence).toBeCloseTo(0.82, 5)
    entry = await Memory.confirm(repo, "k")
    expect(entry.confidence).toBeLessThan(1)
    expect(entry.confidence).toBeCloseTo(0.892, 5)
  })

  it("dispute halves confidence and marks the entry disputed with an event", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "api", fact: "REST API", confidence: 0.9 })
    const entry = await Memory.dispute(repo, "api", "schema.graphql exists", { path: "schema.graphql" })

    expect(entry.status).toBe("disputed")
    expect(entry.confidence).toBeCloseTo(0.45, 5)

    const events = await Events.read(repo, { event: "memory.disputed" })
    expect(events.length).toBe(1)
  })

  it("resolve re-activates a disputed fact", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "api", fact: "REST API", confidence: 0.9 })
    await Memory.dispute(repo, "api", "conflict")
    const entry = await Memory.resolve(repo, "api", "GraphQL API", [{ path: "schema.graphql" }])

    expect(entry.status).toBe("active")
    expect(entry.fact).toBe("GraphQL API")
    expect(entry.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("deprecate zeroes confidence but keeps the audit trail", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "ci", fact: "uses travis" })
    const entry = await Memory.deprecate(repo, "ci", "migrated to github actions")

    expect(entry.confidence).toBe(0)
    expect(entry.status).toBe("deprecated")
    expect(entry.history.map((item) => item.action)).toEqual(["added", "deprecated"])
  })

  it("searches by key and fact, and filters by status", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "database", fact: "PostgreSQL via prisma" })
    await Memory.add(repo, { key: "frontend", fact: "SolidJS" })
    await Memory.deprecate(repo, "frontend")

    expect((await Memory.list(repo, { query: "postgres" })).map((entry) => entry.key)).toEqual(["database"])
    expect((await Memory.list(repo, { status: "deprecated" })).map((entry) => entry.key)).toEqual(["frontend"])
    expect((await Memory.list(repo)).length).toBe(2)
    expect((await Memory.get(repo, "database"))?.fact).toBe("PostgreSQL via prisma")
  })

  it("removes entries", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "tmp", fact: "x" })
    expect(await Memory.remove(repo, "tmp")).toBe(true)
    expect(await Memory.remove(repo, "tmp")).toBe(false)
  })

  it("keeps entries sorted by key for merge-friendly diffs", async () => {
    const repo = await tempdir()
    await Memory.add(repo, { key: "zeta", fact: "z" })
    await Memory.add(repo, { key: "alpha", fact: "a" })

    const raw = await Bun.file(Memory.file(repo)).text()
    expect(raw.indexOf('"alpha"')).toBeLessThan(raw.indexOf('"zeta"'))
  })

  it("throws on unknown keys and invalid stores", async () => {
    const repo = await tempdir()
    await rejects(Memory.confirm(repo, "ghost"), "no memory entry")

    const { mkdir } = await import("node:fs/promises")
    await mkdir(`${repo}/.noxijent`, { recursive: true })
    await Bun.write(`${repo}/.noxijent/memory.json`, `{"version":2}`)
    await rejects(Memory.load(repo), "invalid memory store")
  })
})
