import { afterEach, describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { Events } from "../../src/noxijent"
import { cleanup, rejects, tempdir } from "./helpers"

afterEach(cleanup)

describe("events", () => {
  it("emits events with a timestamp and stores them as JSONL", async () => {
    const repo = await tempdir()
    await Events.emit(repo, { event: "task.completed", task: "AUTH-42", agent: "backend", data: { tests_passed: 142 } })

    const raw = await readFile(Events.file(repo), "utf8")
    const line = raw.trim().split("\n")[0]
    const parsed = JSON.parse(line)
    expect(parsed.event).toBe("task.completed")
    expect(parsed.task).toBe("AUTH-42")
    expect(parsed.agent).toBe("backend")
    expect(parsed.data).toEqual({ tests_passed: 142 })
    expect(typeof parsed.ts).toBe("number")
  })

  it("appends multiple events and reads them back in order", async () => {
    const repo = await tempdir()
    await Events.emit(repo, { event: "task.started", task: "t1" })
    await Events.emit(repo, { event: "verify.passed", task: "t1" })
    await Events.emit(repo, { event: "task.completed", task: "other" })

    const all = await Events.read(repo)
    expect(all.map((event) => event.event)).toEqual(["task.started", "verify.passed", "task.completed"])
  })

  it("filters by task, agent, event name, regex and tail", async () => {
    const repo = await tempdir()
    for (let i = 1; i <= 5; i++) {
      await Events.emit(repo, { event: "verify.attempt", task: "t", agent: i % 2 === 0 ? "a" : "b", data: { i } })
    }

    expect((await Events.read(repo, { agent: "a" })).length).toBe(2)
    expect((await Events.read(repo, { tail: 2 })).map((event) => event.data?.i)).toEqual([4, 5])
    expect((await Events.read(repo, { event: /^verify\./ })).length).toBe(5)
    expect(await Events.read(repo, { task: "nope" })).toEqual([])
  })

  it("tolerates malformed lines when reading", async () => {
    const repo = await tempdir()
    await Events.emit(repo, { event: "ok", task: "t" })
    const { appendFile } = await import("node:fs/promises")
    await appendFile(Events.file(repo), "this is not json\n")
    await appendFile(Events.file(repo), '{"event":"missing-ts"}\n')

    const events = await Events.read(repo)
    expect(events.length).toBe(1)
    expect(events[0].event).toBe("ok")
  })

  it("reads an empty list when no log exists", async () => {
    const repo = await tempdir()
    expect(await Events.read(repo)).toEqual([])
  })

  it("validates emitted events", async () => {
    const repo = await tempdir()
    // schema validation rejects events without a name
    await rejects(Events.emit(repo, { task: "t" } as Events.EventInput), "event")
  })
})
