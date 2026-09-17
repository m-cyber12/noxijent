import { afterEach, describe, expect, it } from "bun:test"
import path from "path"
import { Events, Verify } from "../../src/noxijent"
import { cleanup, rejects, tempdir } from "./helpers"

afterEach(cleanup)

describe("verify", () => {
  it("passes on the first attempt when checks are green", async () => {
    const repo = await tempdir()
    const result = await Verify.run({
      repo,
      config: { checks: [{ name: "tests", command: "exit 0", required: true, timeoutMs: 10_000 }] },
    })
    expect(result.ok).toBe(true)
    expect(result.attempts.length).toBe(1)
  })

  it("fails after one attempt without a fixer", async () => {
    const repo = await tempdir()
    const result = await Verify.run({
      repo,
      maxAttempts: 3,
      config: { checks: [{ name: "tests", command: "exit 1", required: true, timeoutMs: 10_000 }] },
    })
    expect(result.ok).toBe(false)
    expect(result.attempts.length).toBe(1)
  })

  it("re-runs checks after the fixer until green", async () => {
    const repo = await tempdir()
    const marker = path.join(repo, "fixed")
    const result = await Verify.run({
      repo,
      task: "loop",
      maxAttempts: 3,
      config: { checks: [{ name: "tests", command: `test -f "${marker}"`, required: true, timeoutMs: 10_000 }] },
      fix: async (ctx) => {
        expect(ctx.failures.length).toBe(1)
        if (ctx.attempt === 1) await Bun.write(marker, "fixed\n")
      },
    })

    expect(result.ok).toBe(true)
    expect(result.attempts.length).toBe(2)
    expect(result.attempts[0]?.fixed).toBe(true)

    const events = await Events.read(repo, { task: "loop" })
    expect(events.map((event) => event.event)).toEqual(["verify.failed", "verify.fix.started", "verify.passed"])
  })

  it("stops at maxAttempts and reports remaining failures", async () => {
    const repo = await tempdir()
    let fixes = 0
    const result = await Verify.run({
      repo,
      maxAttempts: 2,
      config: { checks: [{ name: "tests", command: "exit 1", required: true, timeoutMs: 10_000 }] },
      fix: async () => {
        fixes++
      },
    })

    expect(result.ok).toBe(false)
    expect(result.attempts.length).toBe(2)
    expect(fixes).toBe(1)
  })

  it("loads the contract from the repository when config is omitted", async () => {
    const repo = await tempdir()
    const { mkdir } = await import("node:fs/promises")
    await mkdir(path.join(repo, ".noxijent"), { recursive: true })
    await Bun.write(path.join(repo, ".noxijent", "done.jsonc"), `{ "checks": [{ "name": "ok", "command": "exit 0" }] }`)

    const result = await Verify.run({ repo })
    expect(result.ok).toBe(true)
  })

  it("throws when no contract exists", async () => {
    const repo = await tempdir()
    await rejects(Verify.run({ repo }), "definition of done")
  })
})
