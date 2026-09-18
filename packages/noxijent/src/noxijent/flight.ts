// Agent flight recorder (roadmap §30 / Phase 3 #17): a structured per-task
// execution timeline — what happened, which agent did it, and when — for
// post-hoc observability and recovery narratives. Entries are append-only
// JSONL under `.noxijent/state/flight/` and every mark is mirrored into the
// structured event log.

import { appendFile, readFile } from "node:fs/promises"
import { z } from "zod"
import { emit as emitEvent } from "./events"
import * as Paths from "./paths"

export const Mark = z.object({
  at: z.number(),
  label: z.string().min(1),
  agent: z.string().optional(),
  data: z.record(z.string(), z.any()).optional(),
})
export type Mark = z.infer<typeof Mark>

function file(repo: string, task: string) {
  return Paths.stateDir(repo, "flight", `${Paths.slug(task)}.jsonl`)
}

async function append(repo: string, task: string, mark: Mark) {
  await Paths.ensureState(repo, "flight")
  await appendFile(file(repo, task), JSON.stringify(mark) + "\n", "utf8")
}

/** Append a timeline mark. Also mirrored as a `flight.mark` structured event. */
export async function mark(
  repo: string,
  input: { task: string; label: string; agent?: string; data?: Record<string, unknown>; at?: number },
): Promise<Mark> {
  const entry = Mark.parse({ ...input, at: input.at ?? Date.now() })
  await append(repo, input.task, entry)
  await emitEvent(repo, { event: "flight.mark", task: input.task, agent: input.agent, data: { label: entry.label } })
  return entry
}

/** Convenience wrappers for common lifecycle marks. */
export async function start(repo: string, input: { task: string; agent?: string }) {
  return mark(repo, { task: input.task, agent: input.agent, label: "task started" })
}

export async function complete(repo: string, input: { task: string; agent?: string; data?: Record<string, unknown> }) {
  return mark(repo, { task: input.task, agent: input.agent, data: input.data, label: "task completed" })
}

export async function fail(repo: string, input: { task: string; agent?: string; error: string }) {
  return mark(repo, { task: input.task, agent: input.agent, data: { error: input.error }, label: "task failed" })
}

/** Read the recorded timeline (empty when the task was never recorded). */
export async function timeline(repo: string, task: string): Promise<Mark[]> {
  const target = file(repo, task)
  if (!(await Bun.file(target).exists())) return []
  const text = (await readFile(target, "utf8")).trim()
  if (!text) return []
  return text.split("\n").map((line) => Mark.parse(JSON.parse(line)))
}

function clock(at: number) {
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

/** Render the example timeline from the roadmap (compact ASCII). */
export function render(task: string, marks: Mark[]): string {
  const lines = [`TASK ${task}`, "─".repeat(28), ""]
  if (marks.length === 0) {
    lines.push("(no recorded marks)")
    return lines.join("\n")
  }
  for (const entry of marks) {
    const agent = entry.agent ? ` [${entry.agent}]` : ""
    lines.push(`${clock(entry.at)} ${entry.label}${agent}`)
  }
  return lines.join("\n")
}

export async function summarize(repo: string, task: string) {
  const marks = await timeline(repo, task)
  const agents = [
    ...new Set(marks.map((entry) => entry.agent).filter((agent): agent is string => agent !== undefined)),
  ].sort()
  const started = marks[0]?.at
  const ended = marks[marks.length - 1]?.at
  return {
    task,
    marks: marks.length,
    agents,
    started,
    ended,
    durationMs: started !== undefined && ended !== undefined ? ended - started : undefined,
  }
}
