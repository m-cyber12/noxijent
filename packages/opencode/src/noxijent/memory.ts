import path from "path"
import { z } from "zod"
import { emit } from "./events"
import { root } from "./paths"

/**
 * Project memory with evidence and confidence (roadmap §5, §6).
 *
 * Persistent, project-specific engineering knowledge lives in
 * `.noxijent/memory.json` — a committable, merge-friendly store (entries are
 * sorted by key, one JSON document, no runtime state). Every entry carries
 * its evidence sources and a confidence score.
 *
 * Memory is not an unquestioned source of truth: new evidence raises or
 * lowers confidence deterministically, contradicted entries become
 * `disputed`, and fixes are recorded in an audit history:
 *
 *   supporting evidence:   c' = 1 - (1 - c) * 0.6      (decaying headroom)
 *   contradicting evidence: c' = c * 0.5, status → disputed
 *   deprecate:             c' = 0
 */

export const Source = z.object({
  path: z.string().min(1),
  note: z.string().optional(),
})
export type Source = z.infer<typeof Source>

export const STATUS = ["active", "disputed", "deprecated"] as const
export type Status = (typeof STATUS)[number]

export const Entry = z.object({
  key: z.string().min(1),
  fact: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(STATUS).default("active"),
  sources: z.array(Source).default([]),
  updatedAt: z.string(),
  history: z
    .array(
      z.object({
        at: z.string(),
        action: z.enum(["added", "updated", "confirmed", "disputed", "resolved", "deprecated"]),
        detail: z.string().optional(),
      }),
    )
    .default([]),
})
export type Entry = z.infer<typeof Entry>

const Store = z.object({
  version: z.literal(1),
  entries: z.array(Entry),
})
export type Store = z.infer<typeof Store>

export function file(repo: string) {
  return path.join(root(repo), "memory.json")
}

export async function load(repo: string): Promise<Store> {
  const target = Bun.file(file(repo))
  if (!(await target.exists())) return { version: 1, entries: [] }
  const parsed = Store.safeParse(await target.json())
  if (!parsed.success) {
    throw new Error(`invalid memory store at ${file(repo)}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`)
  }
  return parsed.data
}

export async function save(repo: string, store: Store): Promise<void> {
  const { mkdir } = await import("node:fs/promises")
  await mkdir(root(repo), { recursive: true })
  const sorted = { ...store, entries: [...store.entries].sort((a, b) => a.key.localeCompare(b.key)) }
  await Bun.write(file(repo), JSON.stringify(sorted, null, 2) + "\n")
}

function record(entry: Entry, action: Entry["history"][number]["action"], detail?: string) {
  entry.history.push({ at: new Date().toISOString(), action, detail })
  entry.updatedAt = new Date().toISOString()
}

function mergeSources(existing: Source[], incoming: Source[]) {
  const seen = new Set(existing.map((source) => source.path))
  return [...existing, ...incoming.filter((source) => !seen.has(source.path))]
}

export async function add(
  repo: string,
  input: { key: string; fact: string; confidence?: number; sources?: Source[] },
): Promise<Entry> {
  const store = await load(repo)
  const now = new Date().toISOString()
  const existing = store.entries.find((entry) => entry.key === input.key)

  if (existing) {
    // Same key, same fact: treat as new supporting evidence.
    if (existing.fact === input.fact) {
      return confirm(repo, input.key, input.sources ?? [])
    }
    // Same key, different fact: explicit update (not a contradiction).
    existing.fact = input.fact
    existing.confidence = input.confidence ?? existing.confidence
    existing.sources = mergeSources(existing.sources, input.sources ?? [])
    if (existing.status !== "deprecated") existing.status = "active"
    record(existing, "updated", input.fact)
    await save(repo, store)
    await emit(repo, { event: "memory.updated", data: { key: input.key } })
    return existing
  }

  const confidence = input.confidence ?? 0.5 + Math.min(0.4, (input.sources?.length ?? 0) * 0.1)
  const entry: Entry = {
    key: input.key,
    fact: input.fact,
    confidence: Math.min(1, Math.max(0, confidence)),
    status: "active",
    sources: input.sources ?? [],
    updatedAt: now,
    history: [{ at: now, action: "added" }],
  }
  store.entries.push(entry)
  await save(repo, store)
  await emit(repo, { event: "memory.added", data: { key: input.key, confidence: entry.confidence } })
  return entry
}

/** New supporting evidence for an existing fact: confidence decays toward 1. */
export async function confirm(repo: string, key: string, sources: Source[] = []): Promise<Entry> {
  const store = await load(repo)
  const entry = store.entries.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`no memory entry ${JSON.stringify(key)}`)
  entry.confidence = 1 - (1 - entry.confidence) * 0.6
  entry.sources = mergeSources(entry.sources, sources)
  if (entry.status === "disputed") entry.status = "active"
  record(entry, "confirmed")
  await save(repo, store)
  return entry
}

/** Contradicting evidence: confidence halves and the entry becomes disputed. */
export async function dispute(repo: string, key: string, evidence: string, source?: Source): Promise<Entry> {
  const store = await load(repo)
  const entry = store.entries.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`no memory entry ${JSON.stringify(key)}`)
  entry.confidence = entry.confidence * 0.5
  entry.status = "disputed"
  if (source) entry.sources = mergeSources(entry.sources, [source])
  record(entry, "disputed", evidence)
  await save(repo, store)
  await emit(repo, { event: "memory.disputed", data: { key, evidence } })
  return entry
}

/** Mark an outdated fact as deprecated (kept for audit, confidence zeroed). */
export async function deprecate(repo: string, key: string, detail?: string): Promise<Entry> {
  const store = await load(repo)
  const entry = store.entries.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`no memory entry ${JSON.stringify(key)}`)
  entry.confidence = 0
  entry.status = "deprecated"
  record(entry, "deprecated", detail)
  await save(repo, store)
  return entry
}

export async function resolve(repo: string, key: string, fact: string, sources: Source[] = []): Promise<Entry> {
  const store = await load(repo)
  const entry = store.entries.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`no memory entry ${JSON.stringify(key)}`)
  entry.fact = fact
  entry.status = "active"
  entry.confidence = Math.max(entry.confidence, 0.5)
  entry.sources = mergeSources(entry.sources, sources)
  record(entry, "resolved", fact)
  await save(repo, store)
  return entry
}

export async function get(repo: string, key: string): Promise<Entry | undefined> {
  const store = await load(repo)
  return store.entries.find((entry) => entry.key === key)
}

export async function list(repo: string, opts: { status?: Status; query?: string } = {}): Promise<Entry[]> {
  const store = await load(repo)
  const query = opts.query?.toLowerCase()
  return store.entries.filter((entry) => {
    if (opts.status && entry.status !== opts.status) return false
    if (query && !entry.key.toLowerCase().includes(query) && !entry.fact.toLowerCase().includes(query)) return false
    return true
  })
}

export async function remove(repo: string, key: string): Promise<boolean> {
  const store = await load(repo)
  const before = store.entries.length
  store.entries = store.entries.filter((entry) => entry.key !== key)
  if (store.entries.length === before) return false
  await save(repo, store)
  return true
}
