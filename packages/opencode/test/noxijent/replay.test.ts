import { afterEach, describe, expect, it } from "bun:test"
import { Events, Replay } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

describe("replay", () => {
  it("records a replay with model and checkpoint context", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, {
      task: "Task #1842",
      model: "model-a",
      fromCheckpoint: { task: "task-1842", seq: 3 },
      notes: "original attempt",
    })

    expect(replay.id).toMatch(/^task-1842-\d+$/)
    expect(replay.outcome).toBe("in-progress")
    expect(replay.fromCheckpoint).toEqual({ task: "task-1842", seq: 3 })

    const events = await Events.read(repo, { event: "replay.recorded" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toEqual({ id: replay.id, model: "model-a" })
  })

  it("assigns incrementing ids per task", async () => {
    const repo = await tempdir()
    const first = await Replay.record(repo, { task: "fix" })
    const second = await Replay.record(repo, { task: "fix" })
    expect(second.id).not.toBe(first.id)
    expect(second.id > first.id).toBe(true)
  })

  it("attaches steps and seals the outcome", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, { task: "add oauth" })
    await Replay.attach(repo, replay.id, { kind: "decision", summary: "use PKCE flow" })
    await Replay.attach(repo, replay.id, { kind: "tool", summary: "edit src/auth/oauth.ts" })
    await Replay.attach(repo, replay.id, { kind: "test", summary: "bun test → 3 failed" })
    const done = await Replay.complete(repo, replay.id, { outcome: "done", summary: "all green" })

    expect(done.outcome).toBe("done")
    expect(done.steps.map((step) => step.kind)).toEqual(["decision", "tool", "test", "note"])

    const reloaded = await Replay.get(repo, replay.id)
    expect(reloaded.steps.length).toBe(4)
  })

  it("rejects steps after completion", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, { task: "t" })
    await Replay.complete(repo, replay.id, { outcome: "failed" })
    await expect(Replay.attach(repo, replay.id, { kind: "note", summary: "too late" })).rejects.toBeDefined()
  })

  it("validates step kinds", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, { task: "t" })
    await expect(
      Replay.attach(repo, replay.id, { kind: "chain-of-thought" as never, summary: "private thoughts" }),
    ).rejects.toBeDefined()
  })

  it("lists records per task and skips corrupt files", async () => {
    const repo = await tempdir()
    const a = await Replay.record(repo, { task: "alpha" })
    await Replay.record(repo, { task: "beta" })
    const { ensureState } = await import("../../src/noxijent/paths")
    const state = await ensureState(repo, "replay")
    await Bun.write(`${state}/garbage.json`, "not json\n")

    const all = await Replay.list(repo)
    expect(all.map((replay) => replay.task).sort()).toEqual(["alpha", "beta"])
    const onlyAlpha = await Replay.list(repo, { task: "alpha" })
    expect(onlyAlpha.map((replay) => replay.id)).toEqual([a.id])
  })

  it("produces a replayable spec without chain-of-thought", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, { task: "t", model: "model-b", fromCheckpoint: { task: "t", seq: 1 } })
    await Replay.attach(repo, replay.id, {
      kind: "decision",
      summary: "split jwt validation",
      data: { secretNote: "not in spec" },
    })
    await Replay.complete(repo, replay.id, { outcome: "done" })

    const output = Replay.spec(await Replay.get(repo, replay.id))
    expect(output.task).toBe("t")
    expect(output.model).toBe("model-b")
    expect(output.fromCheckpoint).toEqual({ task: "t", seq: 1 })
    expect(output.outcome).toBe("done")
    expect(output.steps).toEqual([{ kind: "decision", summary: "split jwt validation" }])
    expect(JSON.stringify(output)).not.toContain("secretNote")
  })

  it("renders a human-readable record", async () => {
    const repo = await tempdir()
    const replay = await Replay.record(repo, { task: "Task #1", model: "model-a" })
    await Replay.attach(repo, replay.id, { kind: "test", summary: "tests failed" })
    const text = Replay.render(await Replay.get(repo, replay.id))
    expect(text).toContain("Replay task-1-1")
    expect(text).toContain("model-a")
    expect(text).toContain("[test] tests failed")
  })

  it("throws on unknown ids", async () => {
    const repo = await tempdir()
    await expect(Replay.get(repo, "nope-99")).rejects.toBeDefined()
  })
})
