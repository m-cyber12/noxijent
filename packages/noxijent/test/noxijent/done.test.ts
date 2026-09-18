import { afterEach, describe, expect, it } from "bun:test"
import path from "path"
import { Done } from "../../src/noxijent"
import { cleanup, rejects, tempdir } from "./helpers"

afterEach(cleanup)

async function writeConfig(repo: string, contents: string) {
  const dir = path.join(repo, ".noxijent")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, "done.jsonc"), contents)
}

describe("done", () => {
  it("loads a definition of done with defaults", async () => {
    const repo = await tempdir()
    await writeConfig(
      repo,
      `{
        // the repository contract
        "checks": [
          { "name": "tests", "command": "echo ok" },
          { "name": "lint", "command": "echo ok", "required": false }
        ]
      }`,
    )
    const config = await Done.load(repo)
    expect(config?.checks.length).toBe(2)
    expect(config?.checks[0]?.required).toBe(true)
    expect(config?.checks[1]?.required).toBe(false)
  })

  it("returns undefined when no contract exists", async () => {
    const repo = await tempdir()
    expect(await Done.load(repo)).toBeUndefined()
  })

  it("throws on invalid contract", async () => {
    const repo = await tempdir()
    await writeConfig(repo, `{ "checks": "nope" }`)
    await rejects(Done.load(repo), "invalid")
  })

  it("evaluates required and optional checks", async () => {
    const repo = await tempdir()
    const verdict = await Done.evaluate(repo, {
      checks: [
        { name: "tests", command: "exit 0", required: true, timeoutMs: 10_000 },
        { name: "typecheck", command: "exit 1", required: false, timeoutMs: 10_000 },
        { name: "lint", command: "exit 0", required: false, timeoutMs: 10_000 },
      ],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.results.map((result) => result.ok)).toEqual([true, false, true])
    expect(verdict.failedRequired).toEqual([])
  })

  it("fails only when a required check fails", async () => {
    const repo = await tempdir()
    const verdict = await Done.evaluate(repo, {
      checks: [
        { name: "tests", command: "exit 3", required: true, timeoutMs: 10_000 },
        { name: "lint", command: "exit 0", required: false, timeoutMs: 10_000 },
      ],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.failedRequired.map((result) => result.name)).toEqual(["tests"])
    expect(verdict.results[0]?.exitCode).toBe(3)
  })

  it("captures failing output for inspection", async () => {
    const repo = await tempdir()
    const verdict = await Done.evaluate(repo, {
      checks: [{ name: "tests", command: "echo boom >&2; exit 1", required: true, timeoutMs: 10_000 }],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.results[0]?.output).toContain("boom")
  })

  it("treats timed-out checks as failures", async () => {
    const repo = await tempdir()
    const verdict = await Done.evaluate(repo, {
      checks: [{ name: "slow", command: "sleep 5", required: true, timeoutMs: 300 }],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.results[0]?.ok).toBe(false)
  })
})
