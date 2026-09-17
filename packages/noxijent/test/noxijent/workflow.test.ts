import { afterEach, describe, expect, it } from "bun:test"
import { mkdir } from "node:fs/promises"
import { Events, Workflow } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function define(repo: string, workflow: Record<string, unknown>) {
  await mkdir(`${repo}/.noxijent/workflows`, { recursive: true })
  await Bun.write(`${repo}/.noxijent/workflows/${workflow.name}.json`, JSON.stringify(workflow))
}

describe("workflow", () => {
  it("loads, lists and validates workflows", async () => {
    const repo = await tempdir()
    await define(repo, { name: "bugfix", steps: [{ id: "reproduce" }] })
    await define(repo, { name: "release", steps: [{ id: "ship" }] })

    const loaded = await Workflow.load(repo, "bugfix")
    expect(loaded.steps[0]!.uses).toBe("note")
    expect(await Workflow.list(repo)).toEqual(["bugfix", "release"])

    await define(repo, { name: "broken", steps: [{ id: "x", uses: "teleport" }] })
    await expect(Workflow.load(repo, "broken")).rejects.toThrow("invalid workflow broken")
    await expect(Workflow.load(repo, "missing")).rejects.toThrow("no workflow named missing")
  })

  it("compiles steps into a validated execution graph", async () => {
    const repo = await tempdir()
    await define(repo, {
      name: "graphy",
      steps: [{ id: "one" }, { id: "two", dependsOn: ["one"] }],
    })
    const workflow = await Workflow.load(repo, "graphy")

    const graph = Workflow.compile(workflow)
    expect(graph.nodes.map((node) => node.id)).toEqual(["one", "two"])
    expect(graph.nodes[1]!.dependencies).toEqual(["one"])
    expect(graph.nodes[1]!.description).toBe("note step two")
  })

  it("rejects dependency cycles at compile time", async () => {
    const repo = await tempdir()
    await define(repo, {
      name: "cycle",
      steps: [
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["a"] },
      ],
    })
    const workflow = await Workflow.load(repo, "cycle")
    expect(() => Workflow.compile(workflow)).toThrow()
  })

  it("runs note/context/hook steps and records the run", async () => {
    const repo = await tempdir()
    const { mkdir: make } = await import("node:fs/promises")
    await make(`${repo}/src/api`, { recursive: true })
    await Bun.write(`${repo}/src/api/handler.ts`, "export const ok = true\n")
    await define(repo, {
      name: "bugfix",
      steps: [
        { id: "understand_issue", description: "understand the reported issue" },
        { id: "find_context", uses: "context", params: { query: "handler" }, dependsOn: ["understand_issue"] },
        { id: "run_hooks", uses: "hook", params: { point: "after_task" }, dependsOn: ["find_context"] },
      ],
    })

    const record = await Workflow.run(repo, "bugfix", { task: "issue-9" })
    expect(record.ok).toBe(true)
    expect(record.nodes.map((node) => node.status)).toEqual(["done", "done", "done"])
    expect(record.nodes[1]!.output).toEqual({ selected: ["src/api/handler.ts"] })

    const events = await Events.read(repo, { event: "workflow.completed" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ workflow: "bugfix", ok: true })

    const latest = await Workflow.latest(repo, "bugfix")
    expect(latest!.task).toBe("issue-9")
  })

  it("fails the run (without throwing) when a step fails", async () => {
    const repo = await tempdir()
    const { mkdir: make } = await import("node:fs/promises")
    await make(`${repo}/.noxijent`, { recursive: true })
    await Bun.write(
      `${repo}/.noxijent/hooks.json`,
      JSON.stringify({ hooks: { before_tool: [{ command: ["bun", "-e", "process.exitCode = 1"] }] } }),
    )
    await define(repo, {
      name: "guarded",
      steps: [
        { id: "hook_step", uses: "hook", params: { point: "before_tool" } },
        { id: "afterwards", dependsOn: ["hook_step"] },
      ],
    })

    const record = await Workflow.run(repo, "guarded")
    expect(record.ok).toBe(false)
    expect(record.nodes[0]!.status).toBe("failed")
    expect(record.nodes[0]!.error).toContain("hook chain failed at before_tool")
    expect(record.nodes[1]!.status).toBe("skipped")

    const events = await Events.read(repo, { event: "workflow.failed" })
    expect(events.length).toBe(1)
  })

  it("runs repro scaffolds as a step", async () => {
    const repo = await tempdir()
    const { mkdir: make } = await import("node:fs/promises")
    await make(`${repo}/src`, { recursive: true })
    await Bun.write(`${repo}/src/limiter.ts`, "export {}\n")
    await define(repo, {
      name: "repro-flow",
      steps: [{ id: "reproduce", uses: "repro", params: { issue: "limiter resets sessions" } }],
    })

    const record = await Workflow.run(repo, "repro-flow")
    expect(record.ok).toBe(true)
    const output = record.nodes[0]!.output as { scaffold: string; suspects: string[] }
    expect(output.scaffold).toContain(".noxijent/state/repro/")
    expect(output.suspects).toEqual(["src/limiter.ts"])
  })

  it("renders run records", async () => {
    const repo = await tempdir()
    await define(repo, { name: "simple", steps: [{ id: "only" }] })
    const record = await Workflow.run(repo, "simple")
    const text = Workflow.render(record)
    expect(text).toContain("workflow simple")
    expect(text).toContain("✓ only")
    expect(text).toContain("ok")
  })
})
