import { afterEach, describe, expect, it } from "bun:test"
import { Events, Hooks } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

type HookEntries = { [K in (typeof Hooks.POINTS)[number]]?: Array<Record<string, unknown>> }

function config(entries: HookEntries) {
  return Hooks.Config.parse({ hooks: entries })
}

describe("hooks", () => {
  it("loads an empty config when no hooks file exists", async () => {
    const repo = await tempdir()
    const loaded = await Hooks.load(repo)
    expect(Hooks.registered(loaded, "on_failure")).toEqual([])
  })

  it("loads and validates .noxijent/hooks.json", async () => {
    const repo = await tempdir()
    const { mkdir } = await import("node:fs/promises")
    await mkdir(`${repo}/.noxijent`, { recursive: true })
    await Bun.write(
      `${repo}/.noxijent/hooks.json`,
      JSON.stringify({ hooks: { on_failure: [{ command: ["bun", "-e", "0"] }] } }),
    )
    const loaded = await Hooks.load(repo)
    expect(loaded.hooks.on_failure![0]!.onError).toBe("block")
    expect(loaded.hooks.on_failure![0]!.timeoutMs).toBe(10_000)

    await Bun.write(`${repo}/.noxijent/hooks.json`, JSON.stringify({ hooks: { bogus: [] } }))
    await expect(Hooks.load(repo)).rejects.toThrow("invalid .noxijent/hooks.json")
  })

  it("runs hooks with JSON context on stdin and env vars", async () => {
    const repo = await tempdir()
    const script = [
      "bun",
      "-e",
      "const text = await new Response(Bun.stdin.stream()).text(); await Bun.write('seen.json', text)",
    ]
    const result = await Hooks.run(
      repo,
      "before_task",
      { task: "deploy", detail: 42 },
      { config: config({ before_task: [{ command: script }] }) },
    )

    expect(result.ok).toBe(true)
    expect(result.results.length).toBe(1)
    const seen = JSON.parse(await Bun.file(`${repo}/seen.json`).text())
    expect(seen).toEqual({ task: "deploy", detail: 42 })
  })

  it("runs hooks in order and continues past warn failures", async () => {
    const repo = await tempdir()
    const append = (text: string) =>
      `await Bun.write('order.txt', (await Bun.file('order.txt').text().catch(() => '')) + '${text}')`
    const loaded = config({
      on_failure: [
        { command: ["bun", "-e", "process.exitCode = 3"], onError: "warn" },
        { command: ["bun", "-e", append("b")] },
        { command: ["bun", "-e", append("c")] },
      ],
    })
    const result = await Hooks.run(repo, "on_failure", {}, { config: loaded })

    expect(result.ok).toBe(false)
    expect(result.results.length).toBe(3)
    expect(result.results[0]!.error).toBe("exit 3")
    expect(await Bun.file(`${repo}/order.txt`).text()).toBe("bc")
  })

  it("stops the chain on a failing block hook", async () => {
    const repo = await tempdir()
    const loaded = config({
      on_checkpoint: [
        { command: ["bun", "-e", "process.exitCode = 1"] },
        { command: ["bun", "-e", "await Bun.write('never.txt', 'x')"] },
      ],
    })
    const result = await Hooks.run(repo, "on_checkpoint", {}, { config: loaded })

    expect(result.ok).toBe(false)
    expect(result.results.length).toBe(1)
    expect(result.results[0]!.blocked).toBe(true)
    expect(await Bun.file(`${repo}/never.txt`).exists()).toBe(false)
  })

  it("enforces hook timeouts", async () => {
    const repo = await tempdir()
    const loaded = config({
      before_tool: [{ command: ["bun", "-e", "setTimeout(() => {}, 8000)"], timeoutMs: 500, onError: "warn" }],
    })
    const result = await Hooks.run(repo, "before_tool", {}, { config: loaded })

    expect(result.ok).toBe(false)
    expect(result.results[0]!.error).toContain("timed out")

    const events = await Events.read(repo, { event: "hook.ran" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ point: "before_tool", ok: false })
  }, 12000)

  it("emits a hook.ran event with the task attribution", async () => {
    const repo = await tempdir()
    await Hooks.run(
      repo,
      "after_task",
      { task: "build-7" },
      { config: config({ after_task: [{ command: ["bun", "-e", "0"] }] }) },
    )

    const events = await Events.read(repo, { event: "hook.ran" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ point: "after_task", hooks: 1, ok: true, task: "build-7" })
  })

  it("requires argv commands (no shell strings)", () => {
    expect(() => config({ before_task: [{ command: "rm -rf /" as never }] })).toThrow()
  })
})
