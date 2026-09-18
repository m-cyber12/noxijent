// Task replay (roadmap §9 / Phase 3 #16): record reproducible execution
// metadata for an engineering task — spec, model, checkpoint it started
// from, concise decision/tool/test summaries and the outcome — so the task
// can be replayed (e.g. with another model or from another checkpoint)
// without ever storing private chain-of-thought.

import { readdir, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import { emit as emitEvent } from "./events"
import * as Paths from "./paths"

export const Step = z.object({
  at: z.number(),
  kind: z.enum(["decision", "tool", "test", "note"]),
  summary: z.string().min(1),
  data: z.record(z.string(), z.any()).optional(),
})
export type Step = z.infer<typeof Step>

export const OUTCOME = ["in-progress", "done", "failed", "aborted"] as const

export const Replay = z.object({
  id: z.string(),
  task: z.string(),
  model: z.string().optional(),
  fromCheckpoint: z.object({ task: z.string(), seq: z.number() }).optional(),
  notes: z.string().optional(),
  recordedAt: z.number(),
  steps: z.array(Step).default([]),
  outcome: z.enum(OUTCOME).default("in-progress"),
})
export type Replay = z.infer<typeof Replay>

function dir(repo: string) {
  return Paths.stateDir(repo, "replay")
}

function file(repo: string, id: string) {
  return path.join(dir(repo), `${id}.json`)
}

async function save(repo: string, replay: Replay) {
  await Paths.ensureState(repo, "replay")
  await Bun.write(file(repo, replay.id), JSON.stringify(replay, null, 2) + "\n")
}

async function load(repo: string, id: string): Promise<Replay> {
  const target = file(repo, id)
  const text = await readFile(target, "utf8").catch(() => {
    throw new Error(`no replay record named ${id}`)
  })
  try {
    return Replay.parse(JSON.parse(text))
  } catch {
    throw new Error(`corrupt replay record ${id}`)
  }
}

async function nextSeq(repo: string, slug: string) {
  const files = await readdir(dir(repo)).catch(() => [] as string[])
  let max = 0
  for (const entry of files) {
    const match = entry.match(new RegExp(`^${slug}-(\\d+)\\.json$`))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

/** Start a replay record for a task. */
export async function record(
  repo: string,
  input: { task: string; model?: string; notes?: string; fromCheckpoint?: { task: string; seq: number } },
): Promise<Replay> {
  const slug = Paths.slug(input.task)
  const replay: Replay = {
    id: `${slug}-${await nextSeq(repo, slug)}`,
    task: input.task,
    model: input.model,
    fromCheckpoint: input.fromCheckpoint,
    notes: input.notes,
    recordedAt: Date.now(),
    steps: [],
    outcome: "in-progress",
  }
  await save(repo, replay)
  await emitEvent(repo, { event: "replay.recorded", task: input.task, data: { id: replay.id, model: replay.model } })
  return replay
}

/** Append a concise step (decision summary, tool action, test result, note). */
export async function attach(
  repo: string,
  id: string,
  step: { kind: Step["kind"]; summary: string; data?: Record<string, unknown>; at?: number },
): Promise<Replay> {
  const replay = await load(repo, id)
  if (replay.outcome !== "in-progress") throw new Error(`replay ${id} is already ${replay.outcome}`)
  replay.steps.push(Step.parse({ ...step, at: step.at ?? Date.now() }))
  await save(repo, replay)
  return replay
}

/** Seal a replay record with its outcome. */
export async function complete(
  repo: string,
  id: string,
  input: { outcome: Exclude<(typeof OUTCOME)[number], "in-progress">; summary?: string },
): Promise<Replay> {
  const replay = await load(repo, id)
  replay.outcome = input.outcome
  if (input.summary) replay.steps.push(Step.parse({ kind: "note", summary: input.summary, at: Date.now() }))
  await save(repo, replay)
  return replay
}

export async function get(repo: string, id: string): Promise<Replay> {
  return load(repo, id)
}

export async function list(repo: string, opts: { task?: string } = {}): Promise<Replay[]> {
  const files = (await readdir(dir(repo)).catch(() => [] as string[])).filter((entry) => entry.endsWith(".json")).sort()
  const result: Replay[] = []
  for (const entry of files) {
    try {
      const replay = Replay.parse(JSON.parse(await readFile(path.join(dir(repo), entry), "utf8")))
      if (opts.task && replay.task !== opts.task) continue
      result.push(replay)
    } catch {
      // skip corrupt records rather than failing the listing
    }
  }
  return result
}

/**
 * The reproducible spec: everything needed to run the task again — ordered
 * decision/tool/test summaries, never chain-of-thought.
 */
export function spec(replay: Replay) {
  return {
    task: replay.task,
    model: replay.model,
    fromCheckpoint: replay.fromCheckpoint,
    outcome: replay.outcome,
    steps: replay.steps.map((step) => ({ kind: step.kind, summary: step.summary })),
  }
}

export function render(replay: Replay): string {
  const lines = [
    `Replay ${replay.id}`,
    ``,
    `task:      ${replay.task}`,
    `model:     ${replay.model ?? "unknown"}`,
    `from:      ${replay.fromCheckpoint ? `checkpoint ${replay.fromCheckpoint.task}#${replay.fromCheckpoint.seq}` : "(initial state)"}`,
    `outcome:   ${replay.outcome}`,
    `recorded:  ${new Date(replay.recordedAt).toISOString()}`,
  ]
  if (replay.notes) lines.push(`notes:     ${replay.notes}`)
  if (replay.steps.length > 0) {
    lines.push(``, `steps:`)
    for (const step of replay.steps) lines.push(`  [${step.kind}] ${step.summary}`)
  }
  return lines.join("\n")
}
