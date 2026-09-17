// Agent hooks (roadmap §28 / Phase 4 #24): lifecycle hook points declared in
// `.noxijent/hooks.json` — commands that run around tasks, tool calls,
// checkpoints and failures, so developers customize behavior without
// modifying noxijent core. Hook commands receive a JSON context on stdin
// and NOXIJENT_HOOK_* env vars; a failing "block" hook stops the chain.

import path from "path"
import { z } from "zod"
import { emit as emitEvent } from "./events"

export const POINTS = [
  "before_task",
  "after_task",
  "before_tool",
  "after_tool",
  "on_failure",
  "on_checkpoint",
  "on_complete",
] as const
export type Point = (typeof POINTS)[number]

export const Hook = z.object({
  command: z.array(z.string()).min(1),
  /** block: stop the chain and fail; warn: continue after logging */
  onError: z.enum(["block", "warn"]).default("block"),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
  description: z.string().optional(),
})
export type Hook = z.infer<typeof Hook>

export const Config = z
  .object({
    hooks: z
      .record(z.string(), z.array(Hook))
      .default({})
      .superRefine((points, ctx) => {
        for (const point of Object.keys(points)) {
          if (!(POINTS as readonly string[]).includes(point)) {
            ctx.addIssue({
              code: "custom",
              message: `unknown hook point ${JSON.stringify(point)} (expected one of ${POINTS.join(", ")})`,
            })
          }
        }
      }),
  })
  .strict()
export type Config = z.infer<typeof Config>

export type Result = {
  point: Point
  ok: boolean
  results: Array<{
    command: string[]
    ok: boolean
    durationMs: number
    outputTail: string
    error?: string
    blocked?: boolean
  }>
}

function file(repo: string) {
  return path.join(repo, ".noxijent", "hooks.json")
}

/** Load the project's hook configuration (empty config when none exists). */
export async function load(repo: string): Promise<Config> {
  const text = await Bun.file(file(repo))
    .text()
    .catch(() => "")
  if (!text.trim()) return Config.parse({})
  try {
    return Config.parse(JSON.parse(text))
  } catch (error) {
    throw new Error(`invalid .noxijent/hooks.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Hooks registered for a lifecycle point. */
export function registered(config: Config, point: Point): Hook[] {
  return config.hooks[point] ?? []
}

async function exec(
  repo: string,
  hook: Hook,
  point: Point,
  context: Record<string, unknown>,
): Promise<Result["results"][number]> {
  const startedAt = Date.now()
  let exited = false
  let killed = false
  const proc = Bun.spawn(hook.command, {
    cwd: repo,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NOXIJENT_HOOK_POINT: point,
      NOXIJENT_HOOK_TASK: String(context.task ?? ""),
      NOXIJENT_HOOK_CONTEXT: JSON.stringify(context),
    },
  })
  const timer = setTimeout(() => {
    if (!exited) {
      killed = true
      proc.kill("SIGKILL")
    }
  }, hook.timeoutMs)
  proc.stdin.write(JSON.stringify(context))
  proc.stdin.end()
  const [code, out, err] = await Promise.all([
    proc.exited.then((value) => {
      exited = true
      return value
    }),
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
  ])
  clearTimeout(timer)
  const outputTail = (out + err).trim().split("\n").slice(-5).join("\n")
  return {
    command: hook.command,
    ok: !killed && code === 0,
    durationMs: Date.now() - startedAt,
    outputTail,
    error: killed ? `timed out after ${hook.timeoutMs}ms` : code === 0 ? undefined : `exit ${code}`,
  }
}

/** Run every hook registered for a point, honoring block/warn policies. */
export async function run(
  repo: string,
  point: Point,
  context: Record<string, unknown> = {},
  opts: { config?: Config } = {},
): Promise<Result> {
  const config = opts.config ?? (await load(repo))
  const hooks = registered(config, point)
  const results: Result["results"] = []
  let ok = true
  for (const hook of hooks) {
    const outcome = await exec(repo, hook, point, context)
    const blocked = !outcome.ok && hook.onError === "block"
    results.push({ ...outcome, blocked })
    if (!outcome.ok) ok = false
    if (blocked) break
  }
  await emitEvent(repo, {
    event: "hook.ran",
    data: { point, hooks: results.length, ok, task: context.task ?? undefined },
  })
  return { point, ok, results }
}
