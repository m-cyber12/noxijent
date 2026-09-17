import { afterEach, describe, expect, it } from "bun:test"
import { mkdir } from "node:fs/promises"
import { Events, Tournament } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function candidates(repo: string, names: string[]) {
  for (const name of names) await mkdir(`${repo}/candidates/${name}`, { recursive: true })
  return names.map((name) => ({ name, dir: `candidates/${name}` }))
}

const pass = { name: "tests", command: ["bun", "-e", "process.exitCode = 0"] as string[], weight: 3 }
const fail = { name: "types", command: ["bun", "-e", "process.exitCode = 1"] as string[], weight: 1 }

describe("tournament", () => {
  it("ranks candidates by weighted objective signals", async () => {
    const repo = await tempdir()
    const specs = await candidates(repo, ["agent-a", "agent-b"])

    const report = await Tournament.run(repo, { task: "difficult refactor", candidates: specs, signals: [pass] })
    expect(report.candidates.map((candidate) => candidate.name)).toEqual(["agent-a", "agent-b"])
    expect(report.candidates[0]!.score).toBe(1)
    expect(report.winner).toBeUndefined() // tie
    expect(report.note).toContain("tie between agent-a, agent-b")
  })

  it("breaks ties with per-signal pass rates", async () => {
    const repo = await tempdir()
    const specs = await candidates(repo, ["good", "bad"])
    await Bun.write(`${repo}/candidates/good/passes.ts`, "export {}\n")

    const report = await Tournament.run(repo, {
      task: "oauth flow",
      candidates: specs,
      signals: [
        {
          name: "file-present",
          command: ["bun", "-e", "if (!(await Bun.file('passes.ts').exists())) process.exitCode = 1"],
          weight: 3,
        },
        { name: "smoke", command: ["bun", "-e", "process.exitCode = 0"], weight: 1 },
      ],
    })

    expect(report.winner).toBe("good")
    expect(report.candidates[0]!.name).toBe("good")
    expect(report.candidates[0]!.score).toBe(1)
    expect(report.candidates[1]!.score).toBe(0.25)
    expect(report.candidates[1]!.failed[0]).toContain("file-present")
  })

  it("persists the report and exposes latest/list", async () => {
    const repo = await tempdir()
    const specs = await candidates(repo, ["a", "b"])
    await Tournament.run(repo, { task: "experiment", candidates: specs, signals: [pass] })

    const latest = await Tournament.latest(repo)
    expect(latest!.task).toBe("experiment")
    const listed = await Tournament.list(repo)
    expect(listed.length).toBe(1)
    expect(listed[0]).toMatch(/^experiment-\d+\.json$/)

    const events = await Events.read(repo, { event: "tournament.completed" })
    expect(events.length).toBe(1)
    expect(events[0]!.task).toBe("experiment")
  })

  it("marks candidates with missing directories instead of crashing", async () => {
    const repo = await tempdir()
    const report = await Tournament.run(repo, {
      task: "ghost",
      candidates: [
        { name: "exists", dir: "." },
        { name: "ghost", dir: "nope" },
      ],
      signals: [pass, fail],
    })

    const ghost = report.candidates.find((candidate) => candidate.name === "ghost")!
    expect(ghost.skipped).toBe("missing directory nope")
    expect(ghost.score).toBe(0)
    const exists = report.candidates.find((candidate) => candidate.name === "exists")!
    expect(exists.passed).toEqual(["tests"])
    expect(exists.failed[0]).toContain("types (exit 1)")
    expect(report.winner).toBe("exists")
  })

  it("validates the spec", async () => {
    const repo = await tempdir()
    await expect(
      Tournament.run(repo, { task: "x", candidates: [{ name: "solo", dir: "." }], signals: [pass] }),
    ).rejects.toThrow()
    await expect(
      Tournament.run(repo, {
        task: "x",
        candidates: [
          { name: "a", dir: "." },
          { name: "b", dir: "." },
        ],
        signals: [pass],
      }),
    ).rejects.toThrow("distinct")
  })

  it("renders the scoreboard", async () => {
    const repo = await tempdir()
    const specs = await candidates(repo, ["alpha", "beta"])
    const report = await Tournament.run(repo, { task: "bugfix #42", candidates: specs, signals: [pass] })
    const text = Tournament.render(report)
    expect(text).toContain("Tournament: bugfix #42")
    expect(text).toContain("alpha")
    expect(text).toContain("tie between alpha, beta")
  })

  it("enforces signal timeouts", async () => {
    const repo = await tempdir()
    const specs = await candidates(repo, ["fast", "slow"])
    await Bun.write(`${repo}/candidates/slow/slow.marker`, "1\n")

    const report = await Tournament.run(repo, {
      task: "timeout-guard",
      candidates: specs,
      signals: [
        {
          name: "respond-in-time",
          command: ["bun", "-e", "if (await Bun.file('slow.marker').exists()) setTimeout(() => {}, 9000)"],
          timeoutMs: 800,
        },
      ],
    })

    expect(report.winner).toBe("fast")
    const slow = report.candidates.find((candidate) => candidate.name === "slow")!
    expect(slow.failed[0]).toContain("timed out")

    const events = await Events.read(repo, { event: "tournament.completed" })
    expect(events.length).toBe(1)
  }, 12000)
})
