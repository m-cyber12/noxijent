// Model tournament (roadmap §21 / Phase 4 #21): run several independent
// candidate implementations against objective engineering signals — tests,
// type checks, benchmarks, security checks — and rank them by weighted
// pass rates. Candidates are directories inside the repository; signals
// are argv commands run in each candidate directory (exit 0 = pass).

import { readdir, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import { emit as emitEvent } from "./events"
import * as Paths from "./paths"

export const Signal = z.object({
  name: z.string().min(1),
  command: z.array(z.string()).min(1),
  weight: z.number().positive().max(100).default(1),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
})
export type Signal = z.infer<typeof Signal>

export const Spec = z
  .object({
    task: z.string().min(1),
    candidates: z
      .array(
        z.object({
          name: z.string().min(1),
          dir: z.string().min(1),
        }),
      )
      .min(2),
    signals: z.array(Signal).min(1),
  })
  .superRefine((spec, ctx) => {
    const dirs = spec.candidates.map((candidate) => candidate.dir)
    if (new Set(dirs).size !== dirs.length) ctx.addIssue({ code: "custom", message: "candidate dirs must be distinct" })
    const names = spec.candidates.map((candidate) => candidate.name)
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: "custom", message: "candidate names must be distinct" })
  })
export type Spec = z.infer<typeof Spec>

export type CandidateResult = {
  name: string
  dir: string
  score: number
  passed: string[]
  failed: string[]
  skipped?: string
  durationMs: number
}

export type Report = {
  at: string
  task: string
  signals: Array<{ name: string; weight: number }>
  candidates: CandidateResult[]
  winner?: string
  note?: string
}

function dir(repo: string) {
  return Paths.stateDir(repo, "tournaments")
}

async function exec(cwd: string, signal: Signal): Promise<{ ok: boolean; error?: string }> {
  let exited = false
  let killed = false
  const proc = Bun.spawn(signal.command, { cwd, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => {
    if (!exited) {
      killed = true
      proc.kill("SIGKILL")
    }
  }, signal.timeoutMs)
  const [code] = await Promise.all([
    proc.exited.then((value) => {
      exited = true
      return value
    }),
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  clearTimeout(timer)
  return {
    ok: !killed && code === 0,
    error: killed ? `timed out after ${signal.timeoutMs}ms` : code === 0 ? undefined : `exit ${code}`,
  }
}

/** Run the tournament and persist the report. */
export async function run(repo: string, input: z.input<typeof Spec>): Promise<Report> {
  const spec = Spec.parse(input)
  const startedAt = Date.now()
  const totalWeight = spec.signals.reduce((sum, signal) => sum + signal.weight, 0)

  const candidates: CandidateResult[] = []
  for (const candidate of spec.candidates) {
    const candidateDir = path.join(repo, candidate.dir)
    const exists = await readdir(candidateDir).then(
      () => true,
      () => false,
    )
    if (!exists) {
      candidates.push({
        name: candidate.name,
        dir: candidate.dir,
        score: 0,
        passed: [],
        failed: [],
        skipped: `missing directory ${candidate.dir}`,
        durationMs: 0,
      })
      continue
    }
    const passed: string[] = []
    const failed: string[] = []
    const candidateStarted = Date.now()
    for (const signal of spec.signals) {
      const outcome = await exec(candidateDir, signal)
      if (outcome.ok) passed.push(signal.name)
      else failed.push(`${signal.name} (${outcome.error})`)
    }
    const wonWeight = spec.signals
      .filter((signal) => passed.includes(signal.name))
      .reduce((sum, signal) => sum + signal.weight, 0)
    candidates.push({
      name: candidate.name,
      dir: candidate.dir,
      score: Math.round((wonWeight / totalWeight) * 100) / 100,
      passed,
      failed,
      durationMs: Date.now() - candidateStarted,
    })
  }

  const best = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const tied = best.filter((entry) => entry.score === best[0]!.score)
  const winner = tied.length === 1 ? tied[0]!.name : undefined
  const report: Report = {
    at: new Date().toISOString(),
    task: spec.task,
    signals: spec.signals.map((signal) => ({ name: signal.name, weight: signal.weight })),
    candidates: best,
    winner,
    note: winner ? undefined : `tie between ${tied.map((entry) => entry.name).join(", ")} — no single winner`,
  }

  await Paths.ensureState(repo, "tournaments")
  const stamp = `${Paths.slug(spec.task)}-${startedAt}`
  await Bun.write(path.join(dir(repo), `${stamp}.json`), JSON.stringify(report, null, 2) + "\n")
  await Bun.write(path.join(dir(repo), "latest.json"), JSON.stringify(report, null, 2) + "\n")
  await emitEvent(repo, {
    event: "tournament.completed",
    task: spec.task,
    data: { candidates: candidates.length, winner: winner ?? null },
  })
  return report
}

export async function list(repo: string): Promise<string[]> {
  const entries = await readdir(dir(repo)).catch(() => [] as string[])
  return entries.filter((entry) => entry.endsWith(".json") && entry !== "latest.json").sort()
}

export async function latest(repo: string): Promise<Report | undefined> {
  const text = await readFile(path.join(dir(repo), "latest.json"), "utf8").catch(() => undefined)
  if (!text) return undefined
  try {
    return JSON.parse(text) as Report
  } catch {
    return undefined
  }
}

export function render(report: Report): string {
  const lines = [`Tournament: ${report.task}`, `at ${report.at}`, ``]
  for (const candidate of report.candidates) {
    const marks = [candidate.name, `${candidate.score.toFixed(2)}`, `passed ${candidate.passed.length}`]
    if (candidate.skipped) marks.push(`[${candidate.skipped}]`)
    if (candidate.failed.length > 0) marks.push(`failed: ${candidate.failed.join("; ")}`)
    lines.push(`  ${marks.join("  ")}`)
  }
  lines.push(``, report.winner ? `winner: ${report.winner}` : (report.note ?? "no winner"))
  return lines.join("\n")
}
