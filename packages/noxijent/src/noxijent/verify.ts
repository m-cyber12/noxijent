import { emit } from "./events"
import { evaluate, load, type Config, type Verdict } from "./done"

/**
 * Automatic test → fix → verify loop (roadmap §8).
 *
 * Verification is a first-class part of every coding task. The loop:
 *
 *   implement → run checks → inspect failure → fix → re-run → ... → done
 *
 * The loop controller itself is deterministic and model-free: it runs the
 * repository's Definition-of-Done contract (§24) after every attempt and
 * invokes a caller-provided `fix` callback between attempts. Agent runtimes
 * plug their "inspect the failure and edit code" step in through `fix`;
 * without one the loop performs a single verification pass.
 */

export type Failure = {
  name: string
  command: string
  exitCode: number
  output: string
}

export type FixContext = {
  repo: string
  attempt: number
  maxAttempts: number
  failures: Failure[]
}

export type Attempt = {
  attempt: number
  verdict: Verdict
  fixed: boolean
}

export type Result = {
  ok: boolean
  attempts: Attempt[]
}

export async function run(opts: {
  repo: string
  config?: Config
  maxAttempts?: number
  task?: string
  fix?: (ctx: FixContext) => Promise<void>
}): Promise<Result> {
  const config = opts.config ?? (await load(opts.repo))
  if (!config) {
    throw new Error(`no definition of done found in ${opts.repo} (.noxijent/done.jsonc)`)
  }
  const maxAttempts = Math.max(1, opts.maxAttempts ?? (opts.fix ? 3 : 1))
  const attempts: Attempt[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const verdict = await evaluate(opts.repo, config)
    attempts.push({ attempt, verdict, fixed: false })

    await emit(opts.repo, {
      event: verdict.ok ? "verify.passed" : "verify.failed",
      task: opts.task,
      data: {
        attempt,
        maxAttempts,
        checks: verdict.results.map((result) => ({ name: result.name, ok: result.ok, required: result.required })),
      },
    })

    if (verdict.ok) return { ok: true, attempts }
    if (!opts.fix || attempt === maxAttempts) return { ok: false, attempts }

    const failures: Failure[] = verdict.results
      .filter((result) => result.required && !result.ok)
      .map((result) => ({
        name: result.name,
        command: result.command,
        exitCode: result.exitCode,
        output: result.output,
      }))

    await emit(opts.repo, {
      event: "verify.fix.started",
      task: opts.task,
      data: { attempt, failures: failures.length },
    })
    await opts.fix({ repo: opts.repo, attempt, maxAttempts, failures })
    attempts[attempts.length - 1].fixed = true
  }

  return { ok: attempts[attempts.length - 1]?.verdict.ok ?? false, attempts }
}
