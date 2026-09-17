import { afterEach, describe, expect, it } from "bun:test"
import { mkdir } from "node:fs/promises"
import { Benchmark, Events } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function scenario(repo: string, name: string, body: Record<string, unknown>) {
  await mkdir(`${repo}/.noxijent/evals/${name}`, { recursive: true })
  await Bun.write(`${repo}/.noxijent/evals/${name}/scenario.json`, JSON.stringify(body))
}

describe("benchmark", () => {
  it("discovers scenarios and skips invalid entries", async () => {
    const repo = await tempdir()
    await scenario(repo, "alpha", { verify: ["bun", "-e", "process.exitCode = 0"] })
    await mkdir(`${repo}/.noxijent/evals/junk`, { recursive: true })

    const found = await Benchmark.scenarios(repo)
    expect(found.map((entry) => entry.name)).toEqual(["alpha"])
    expect(found[0]!.scenario.timeoutMs).toBe(30_000)
  })

  it("rejects invalid scenario files", async () => {
    const repo = await tempdir()
    await scenario(repo, "bad", { verify: [] })
    await expect(Benchmark.scenarios(repo)).rejects.toThrow("invalid scenario bad")
  })

  it("runs scenarios, aggregates stats and persists the run", async () => {
    const repo = await tempdir()
    await scenario(repo, "broken", { verify: ["bun", "-e", "process.exitCode = 1"] })
    await scenario(repo, "demo", { verify: ["bun", "-e", "process.exitCode = 0"] })

    const run = await Benchmark.run(repo)
    expect(run.stats.tasks).toBe(2)
    expect(run.stats.passed).toBe(1)
    expect(run.stats.failed).toBe(1)
    expect(run.results.map((result) => result.name)).toEqual(["broken", "demo"])
    expect(run.results[0]!.ok).toBe(false)
    expect(run.results[0]!.error).toContain("verify failed")
    expect(run.results[1]!.ok).toBe(true)

    expect(await Bun.file(`${repo}/.noxijent/state/benchmark/latest.json`).exists()).toBe(true)
    const history = await Benchmark.history(repo)
    expect(history.length).toBe(1)
    expect(history[0]!.stats.tasks).toBe(2)

    const events = await Events.read(repo, { event: "benchmark.completed" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ tasks: 2, passed: 1, failed: 1 })
  })

  it("runs setup commands before verify", async () => {
    const repo = await tempdir()
    await scenario(repo, "prepared", {
      setup: [["bun", "-e", "await Bun.write('made-by-setup.txt', 'ok')"]],
      verify: ["bun", "-e", "if (!(await Bun.file('made-by-setup.txt').exists())) process.exitCode = 1"],
    })
    const run = await Benchmark.run(repo)
    expect(run.results[0]!.ok).toBe(true)
  })

  it("fails scenarios whose setup fails", async () => {
    const repo = await tempdir()
    await scenario(repo, "doomed", {
      setup: [["bun", "-e", "process.exitCode = 2"]],
      verify: ["bun", "-e", "process.exitCode = 0"],
    })
    const run = await Benchmark.run(repo)
    expect(run.results[0]!.ok).toBe(false)
    expect(run.results[0]!.error).toContain("setup failed")
  })

  it("enforces scenario timeouts", async () => {
    const repo = await tempdir()
    await scenario(repo, "hung", { verify: ["bun", "-e", "setTimeout(() => {}, 10000)"], timeoutMs: 800 })
    const run = await Benchmark.run(repo)
    expect(run.results[0]!.ok).toBe(false)
    expect(run.results[0]!.error).toContain("timed out")
    expect(run.results[0]!.durationMs).toBeLessThan(6000)
  }, 12000)

  it("compares the latest run to the previous one", async () => {
    const repo = await tempdir()
    await scenario(repo, "broken", { verify: ["bun", "-e", "process.exitCode = 1"] })
    const baseline = await Benchmark.compare(repo)
    expect(baseline.comparable).toBe(false)

    await Benchmark.run(repo)
    await scenario(repo, "broken", { verify: ["bun", "-e", "process.exitCode = 0"] })
    await scenario(repo, "newbie", { verify: ["bun", "-e", "process.exitCode = 0"] })
    await Benchmark.run(repo)

    const comparison = await Benchmark.compare(repo)
    expect(comparison.comparable).toBe(true)
    if (comparison.comparable) {
      expect(comparison.fixes).toEqual(["broken"])
      expect(comparison.added).toEqual(["newbie"])
      expect(comparison.regressions).toEqual([])
    }
  })

  it("detects regressions between runs", async () => {
    const repo = await tempdir()
    await scenario(repo, "stable", { verify: ["bun", "-e", "process.exitCode = 0"] })
    await Benchmark.run(repo)
    await scenario(repo, "stable", { verify: ["bun", "-e", "process.exitCode = 1"] })
    await Benchmark.run(repo)

    const comparison = await Benchmark.compare(repo)
    expect(comparison.comparable).toBe(true)
    if (comparison.comparable) expect(comparison.regressions).toEqual(["stable"])
  })

  it("handles a repository with no evals directory", async () => {
    const repo = await tempdir()
    const run = await Benchmark.run(repo)
    expect(run.stats).toEqual({ tasks: 0, passed: 0, failed: 0, avgDurationMs: 0 })
    expect(Benchmark.render(run)).toContain("tasks: 0")
  })

  it("renders the roadmap-style summary", async () => {
    const repo = await tempdir()
    await scenario(repo, "demo", { verify: ["bun", "-e", "process.exitCode = 0"] })
    const run = await Benchmark.run(repo)
    const text = Benchmark.render(run)
    expect(text).toContain("✓ demo")
    expect(text).toContain("passed: 1")
    expect(text).toContain("average duration:")
  })
})
