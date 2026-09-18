import { afterEach, describe, expect, it } from "bun:test"
import { Events, Flight } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

describe("flight", () => {
  it("records marks in order on the task timeline", async () => {
    const repo = await tempdir()
    await Flight.start(repo, { task: "task-A", agent: "manager" })
    await Flight.mark(repo, { task: "task-A", agent: "backend", label: "backend agent started", at: Date.now() + 1 })
    await Flight.complete(repo, { task: "task-A", agent: "manager" })

    const marks = await Flight.timeline(repo, "task-A")
    expect(marks.map((entry) => entry.label)).toEqual(["task started", "backend agent started", "task completed"])
    expect(marks[1]!.agent).toBe("backend")
  })

  it("isolates timelines per task", async () => {
    const repo = await tempdir()
    await Flight.start(repo, { task: "task-A" })
    await Flight.start(repo, { task: "feature/login" })

    expect((await Flight.timeline(repo, "task-A")).length).toBe(1)
    expect((await Flight.timeline(repo, "feature/login")).length).toBe(1)
    expect(await Flight.timeline(repo, "never-recorded")).toEqual([])
  })

  it("renders the roadmap-style timeline", async () => {
    const repo = await tempdir()
    await Flight.mark(repo, {
      task: "#821",
      label: "requirement parsed",
      at: new Date("2026-01-01T18:02:00").getTime(),
    })
    await Flight.mark(repo, {
      task: "#821",
      agent: "backend",
      label: "backend agent started",
      at: new Date("2026-01-01T18:05:00").getTime(),
    })

    const text = Flight.render("#821", await Flight.timeline(repo, "#821"))
    expect(text).toContain("TASK #821")
    expect(text).toContain("18:02 requirement parsed")
    expect(text).toContain("18:05 backend agent started [backend]")
  })

  it("renders an empty timeline without crashing", async () => {
    const text = Flight.render("nope", [])
    expect(text).toContain("(no recorded marks)")
  })

  it("summarizes the timeline", async () => {
    const repo = await tempdir()
    await Flight.mark(repo, { task: "t", label: "start", agent: "manager", at: 1000 })
    await Flight.mark(repo, { task: "t", label: "work", agent: "backend", at: 1500 })
    await Flight.mark(repo, { task: "t", label: "end", agent: "manager", at: 4000 })

    const summary = await Flight.summarize(repo, "t")
    expect(summary.marks).toBe(3)
    expect(summary.agents).toEqual(["backend", "manager"])
    expect(summary.durationMs).toBe(3000)
  })

  it("mirrors marks into the structured event log", async () => {
    const repo = await tempdir()
    await Flight.mark(repo, { task: "watched", agent: "integrator", label: "integration passed" })

    const events = await Events.read(repo, { event: "flight.mark" })
    expect(events.length).toBe(1)
    expect(events[0]!.task).toBe("watched")
    expect(events[0]!.data).toEqual({ label: "integration passed" })
  })

  it("validates marks", async () => {
    const repo = await tempdir()
    await expect(Flight.mark(repo, { task: "t", label: "" })).rejects.toBeDefined()
  })
})
