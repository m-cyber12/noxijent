// Benchmark mode (roadmap §23 / Phase 3 #18): a repository defines
// repeatable engineering scenarios under `.noxijent/evals/<name>/
// scenario.json`; noxijent runs their setup + verify commands, measures
// duration, and keeps a history in `.noxijent/state/benchmark/` so agents,
// prompts and tools can be compared over time (latest vs previous run).

import { readdir, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import { emit as emitEvent } from "./events"
import * as Paths from "./paths"

export const Scenario = z.object({
  name: z.string().optional(),
  /** setup commands, run sequentially before verify (shell-free argv) */
  setup: z.array(z.array(z.string())).default([]),
  /** verification command; exit 0 = pass */
  verify: z.array(z.string()).min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
})
export type Scenario = z.infer<typeof Scenario>

export type Result = {
  name: string
  ok: boolean
  durationMs: number
  outputTail: string
  error?: string
}

export type Run = {
  at: string
  results: Result[]
  stats: { tasks: number; passed: number; failed: number; avgDurationMs: number }
}

function evalsDir(repo: string) {
  return path.join(repo, Paths.DIR, "evals")
}

function stateDir(repo: string) {
  return Paths.stateDir(repo, "benchmark")
}

async function exec(
  repo: string,
  argv: string[],
  timeoutMs: number,
): Promise<{ code: number; output: string; durationMs: number; error?: string }> {
  const startedAt = Date.now()
  let exited = false
  let killed = false
  const proc = Bun.spawn(argv, { cwd: repo, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => {
    if (!exited) {
      killed = true
      proc.kill("SIGKILL")
    }
  }, timeoutMs)
  const [code, out, err] = await Promise.all([
    proc.exited.then((value) => {
      exited = true
      return value
    }),
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  clearTimeout(timer)
  return {
    code,
    output: (out + err).trim().split("\n").slice(-10).join("\n"),
    durationMs: Date.now() - startedAt,
    error: killed ? `timed out after ${timeoutMs}ms` : undefined,
  }
}

/** Discover benchmark scenarios (`.noxijent/evals/<name>/scenario.json`). */
export async function scenarios(
  repo: string,
  opts: { filter?: string } = {},
): Promise<Array<{ name: string; scenario: Scenario }>> {
  const entries = await readdir(evalsDir(repo), { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[])
  const result: Array<{ name: string; scenario: Scenario }> = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    if (opts.filter && entry.name !== opts.filter) continue
    const file = path.join(evalsDir(repo), entry.name, "scenario.json")
    const text = await readFile(file, "utf8").catch(() => undefined)
    if (!text) continue
    try {
      result.push({ name: entry.name, scenario: Scenario.parse({ ...JSON.parse(text), name: entry.name }) })
    } catch (error) {
      throw new Error(`invalid scenario ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return result
}

/** Run scenarios and persist the run (plus `latest.json`). */
export async function run(repo: string, opts: { filter?: string } = {}): Promise<Run> {
  const found = await scenarios(repo, opts)
  const results: Result[] = []
  for (const { name, scenario } of found) {
    const startedAt = Date.now()
    let failed: string | undefined
    for (const argv of scenario.setup) {
      const output = await exec(repo, argv, scenario.timeoutMs)
      if (output.error || output.code !== 0) {
        failed = output.error ?? `setup failed (exit ${output.code}): ${argv.join(" ")}`
        break
      }
    }
    let verifyOut = ""
    if (!failed) {
      const verifyResult = await exec(repo, scenario.verify, scenario.timeoutMs)
      verifyOut = verifyResult.output
      if (verifyResult.error) failed = verifyResult.error
      else if (verifyResult.code !== 0) failed = `verify failed (exit ${verifyResult.code})`
    }
    results.push({ name, ok: !failed, durationMs: Date.now() - startedAt, outputTail: verifyOut, error: failed })
  }

  const passed = results.filter((result) => result.ok).length
  const runResult: Run = {
    at: new Date().toISOString(),
    results,
    stats: {
      tasks: results.length,
      passed,
      failed: results.length - passed,
      avgDurationMs:
        results.length === 0
          ? 0
          : Math.round(results.reduce((total, result) => total + result.durationMs, 0) / results.length),
    },
  }

  await Paths.ensureState(repo, "benchmark")
  const stamp = runResult.at.replace(/[:.]/g, "-")
  await Bun.write(path.join(stateDir(repo), `${stamp}.json`), JSON.stringify(runResult, null, 2) + "\n")
  await Bun.write(path.join(stateDir(repo), "latest.json"), JSON.stringify(runResult, null, 2) + "\n")
  await emitEvent(repo, { event: "benchmark.completed", data: { ...runResult.stats } })
  return runResult
}

async function readRun(repo: string, name: string): Promise<Run | undefined> {
  const text = await readFile(path.join(stateDir(repo), name), "utf8").catch(() => undefined)
  if (!text) return undefined
  try {
    return JSON.parse(text) as Run
  } catch {
    return undefined
  }
}

/** Run history, oldest first (excludes `latest.json`). */
export async function history(repo: string): Promise<Run[]> {
  const files = (await readdir(stateDir(repo)).catch(() => [] as string[]))
    .filter((entry) => entry.endsWith(".json") && entry !== "latest.json")
    .sort()
  const runs: Run[] = []
  for (const entry of files) {
    const runResult = await readRun(repo, entry)
    if (runResult) runs.push(runResult)
  }
  return runs
}

/** Compare the latest run against the previous one: regressions, fixes, duration deltas. */
export async function compare(repo: string) {
  const runs = await history(repo)
  if (runs.length < 2) return { comparable: false as const, runs: runs.length }
  const [previous, latest] = [runs[runs.length - 2]!, runs[runs.length - 1]!]
  const prevByName = new Map(previous.results.map((result) => [result.name, result]))
  const latestByName = new Map(latest.results.map((result) => [result.name, result]))

  const names = [...new Set([...prevByName.keys(), ...latestByName.keys()])].sort()
  const regressions: string[] = []
  const fixes: string[] = []
  const added: string[] = []
  const removed: string[] = []
  const slower: Array<{ name: string; deltaMs: number }> = []
  for (const name of names) {
    const before = prevByName.get(name)
    const now = latestByName.get(name)
    if (before && !now) removed.push(name)
    if (!before && now) added.push(name)
    if (before && now) {
      if (before.ok && !now.ok) regressions.push(name)
      if (!before.ok && now.ok) fixes.push(name)
      if (before.ok && now.ok && now.durationMs > before.durationMs * 1.25 && now.durationMs - before.durationMs > 250)
        slower.push({ name, deltaMs: now.durationMs - before.durationMs })
    }
  }
  return {
    comparable: true as const,
    previous: previous.at,
    latest: latest.at,
    regressions,
    fixes,
    added,
    removed,
    slower: slower.sort((a, b) => b.deltaMs - a.deltaMs),
  }
}

export function render(runResult: Run): string {
  const lines = [`Benchmark run at ${runResult.at}`, ``]
  for (const result of runResult.results) {
    lines.push(
      `${result.ok ? "✓" : "✗"} ${result.name} (${result.durationMs}ms)${result.ok ? "" : ` — ${result.error}`}`,
    )
  }
  lines.push(
    ``,
    `tasks: ${runResult.stats.tasks}`,
    `passed: ${runResult.stats.passed}`,
    `failed: ${runResult.stats.failed}`,
    `average duration: ${runResult.stats.avgDurationMs}ms`,
  )
  return lines.join("\n")
}
