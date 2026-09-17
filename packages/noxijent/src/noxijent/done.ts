import { parse } from "jsonc-parser"
import { z } from "zod"
import { root } from "./paths"

/**
 * Definition of Done as code + automatic verification gate (roadmap §24, §8).
 *
 * The repository defines what "done" means in `.noxijent/done.jsonc`:
 *
 *   {
 *     "checks": [
 *       { "name": "tests",     "command": "bun test",        "required": true },
 *       { "name": "typecheck", "command": "bun typecheck",   "required": true },
 *       { "name": "docs",      "command": "./scripts/docs.sh", "required": false }
 *     ]
 *   }
 *
 * An agent must not declare completion while required checks are failing.
 * `evaluate()` runs the contract and reports a structured verdict; it is a
 * pure evaluation layer — how a failing result is surfaced (to the user, to
 * an agent loop, or into events) is the caller's choice.
 */

export const Check = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(120_000),
})
export type Check = z.infer<typeof Check>

export const Config = z.object({
  checks: z.array(Check).min(1),
})
export type Config = z.infer<typeof Config>

export async function load(repo: string): Promise<Config | undefined> {
  for (const name of ["done.jsonc", "done.json"]) {
    const file = Bun.file(`${root(repo)}/${name}`)
    if (!(await file.exists())) continue
    const parsed = Config.safeParse(parse(await file.text()))
    if (!parsed.success) {
      throw new Error(`invalid ${name} in ${root(repo)}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`)
    }
    return parsed.data
  }
  return undefined
}

export type CheckResult = {
  name: string
  command: string
  required: boolean
  ok: boolean
  exitCode: number
  durationMs: number
  output: string
}

export type Verdict = {
  ok: boolean
  results: CheckResult[]
  failedRequired: CheckResult[]
}

export async function evaluate(repo: string, config: Config): Promise<Verdict> {
  const results: CheckResult[] = []

  for (const check of config.checks) {
    const started = Date.now()
    const proc = Bun.spawn(["sh", "-c", check.command], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => proc.kill(), check.timeoutMs)
    // Read stdout/stderr concurrently with process exit so a full pipe
    // buffer can never deadlock the child process.
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    clearTimeout(timer)
    const timedOut = exitCode !== 0 && Date.now() - started >= check.timeoutMs

    results.push({
      name: check.name,
      command: check.command,
      required: check.required,
      ok: exitCode === 0,
      exitCode,
      durationMs: Date.now() - started,
      output:
        timedOut && !(stdout + stderr).trim()
          ? `timed out after ${check.timeoutMs}ms`
          : (stdout + stderr).trim().slice(-2000),
    })
  }

  const failedRequired = results.filter((result) => result.required && !result.ok)
  return { ok: failedRequired.length === 0, results, failedRequired }
}
