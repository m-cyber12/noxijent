import { afterEach, describe, expect, it } from "bun:test"
import { Events, Repro } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function seed(repo: string) {
  const { mkdir } = await import("node:fs/promises")
  await mkdir(`${repo}/src/api`, { recursive: true })
  await mkdir(`${repo}/src/auth`, { recursive: true })
  await Bun.write(`${repo}/src/api/rate-limit.ts`, "export const bucket = 100\n")
  await Bun.write(`${repo}/src/auth/session.ts`, "export const cookie = 'session'\n")
  await Bun.write(`${repo}/package.json`, JSON.stringify({ name: "x" }))
}

describe("repro", () => {
  it("plans a reproduction with ranked suspects", async () => {
    const repo = await tempdir()
    await seed(repo)

    const plan = await Repro.plan(repo, "users are unexpectedly logged out when the rate limiter resets")
    expect(plan.suspects.length).toBeGreaterThan(0)
    expect(plan.suspects[0]!.file).toBe("src/api/rate-limit.ts")
    expect(plan.scaffoldPath).toMatch(/^\.noxijent\/state\/repro\/users-are-unexpectedly.*\.test\.ts$/)
    expect(plan.stages.join(" → ")).toBe(
      "search code → inspect logs → find suspicious path → create reproduction → write failing test",
    )
  })

  it("writes a failing-test scaffold with suspect context", async () => {
    const repo = await tempdir()
    await seed(repo)

    const plan = await Repro.scaffold(repo, "rate limiter logs users out")
    const written = Repro.list(repo)
    expect((await written).length).toBe(1)

    const { readFile } = await import("node:fs/promises")
    const source = await readFile(`${repo}/${plan.scaffoldPath}`, "utf8")
    expect(source).toContain("// Automatic issue reproduction scaffold (noxijent repro)")
    expect(source).toContain("// Issue: rate limiter logs users out")
    expect(source).toContain("src/api/rate-limit.ts")
    expect(source).toContain('describe("repro: rate limiter logs users out"')
    expect(source).toContain("it.todo")
    expect(source).toContain('import { describe, expect, it } from "bun:test"')

    const events = await Events.read(repo, { event: "repro.scaffolded" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ issue: "rate limiter logs users out" })
  })

  it("still scaffolds when no file matches the issue text", async () => {
    const repo = await tempdir()
    await seed(repo)

    const plan = await Repro.scaffold(repo, "zqx wvb kjd")
    expect(plan.suspects).toEqual([])
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(`${repo}/${plan.scaffoldPath}`, "utf8")
    expect(source).toContain("No suspect files found by name")
    expect(source).toContain("src/…")
  })

  it("honors an explicit target override", async () => {
    const repo = await tempdir()
    await seed(repo)

    const plan = await Repro.scaffold(repo, "logout bug", { target: "src/auth/session.ts" })
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(`${repo}/${plan.scaffoldPath}`, "utf8")
    expect(source).toContain('"../src/auth/session.ts"')
  })

  it("lists scaffolds and reports none for a clean repo", async () => {
    const repo = await tempdir()
    expect(await Repro.list(repo)).toEqual([])
    await Repro.scaffold(repo, "issue alpha")
    await Repro.scaffold(repo, "issue beta")
    expect((await Repro.list(repo)).length).toBe(2)
  })
})
