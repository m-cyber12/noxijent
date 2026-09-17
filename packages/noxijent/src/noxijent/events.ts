import { appendFile, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import { ensureState } from "./paths"

/**
 * Structured agent events (roadmap §29).
 *
 * Everything important emits a machine-readable JSON event, one per line, to
 * `.noxijent/state/events.jsonl`. Appends use O_APPEND so concurrent agents
 * can share the log. Readers are tolerant: malformed lines are skipped, never
 * fatal — the event log is an observability surface, not a control-plane
 * dependency.
 */

export const Schema = z.looseObject({
  event: z.string().min(1),
  ts: z.number().int().positive(),
  task: z.string().optional(),
  agent: z.string().optional(),
  session: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type Event = z.infer<typeof Schema>
export type EventInput = Omit<Event, "ts"> & { ts?: number }

export function file(repo: string) {
  return path.join(repo, ".noxijent", "state", "events.jsonl")
}

export async function emit(repo: string, input: EventInput): Promise<Event> {
  const parsed = Schema.parse({ ...input, ts: input.ts ?? Date.now() })
  const target = file(repo)
  await ensureState(repo)
  await appendFile(target, JSON.stringify(parsed) + "\n", "utf8")
  return parsed
}

export type Filter = {
  task?: string
  agent?: string
  event?: string | RegExp
  tail?: number
}

export async function read(repo: string, filter: Filter = {}): Promise<Event[]> {
  const target = file(repo)
  const raw = await readFile(target, "utf8").catch(() => "")
  const events = raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // Invalid JSON lines are skipped: the event log must never be a
      // control-plane dependency.
      const json = (() => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return undefined
        }
      })()
      if (json === undefined) return undefined
      const parsed = Schema.safeParse(json)
      return parsed.success ? parsed.data : undefined
    })
    .filter((event): event is Event => event !== undefined)

  const matches = events.filter((event) => {
    if (filter.task && event.task !== filter.task) return false
    if (filter.agent && event.agent !== filter.agent) return false
    if (typeof filter.event === "string" && event.event !== filter.event) return false
    if (filter.event instanceof RegExp && !filter.event.test(event.event)) return false
    return true
  })

  if (!filter.tail) return matches
  return matches.slice(-filter.tail)
}
