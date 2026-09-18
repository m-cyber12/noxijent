import path from "path"
import { emit } from "./events"
import { ensureState, slug, stateDir } from "./paths"
import { analyze, listFiles, type Report } from "./understand"

/**
 * Context engine (roadmap §12).
 *
 * A dedicated context-selection layer: instead of every agent independently
 * searching the repository, the engine ranks candidate files for a task by
 * direct token match, import proximity, git recency, test relevance and
 * prior-task failures, then fits the top candidates into a byte budget.
 */

export type Ranked = {
  file: string
  score: number
  reasons: string[]
}

export type RankOptions = {
  repo: string
  query: string
  task?: string
  /** files that mattered in previous failed attempts — boosted */
  previousFailures?: string[]
  maxFiles?: number
  maxBytes?: number
  report?: Report
}

type Scored = { file: string; score: number; reasons: Set<string> }

function tokenize(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((token) => token.length >= 3),
    ),
  ].slice(0, 40)
}

async function recentFiles(repo: string, commits: number) {
  const proc = Bun.spawn(["git", "-C", repo, "log", `--max-count=${commits}`, "--name-only", "--pretty=format:"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, text] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  if (code !== 0) return new Map<string, number>()
  const files = text.split("\n").filter(Boolean)
  const rank = new Map<string, number>()
  files.forEach((file, index) => {
    if (!rank.has(file)) rank.set(file, index)
  })
  return rank
}

export async function rank(opts: RankOptions): Promise<Ranked[]> {
  const tokens = tokenize(opts.query)
  const report = opts.report ?? (await analyze(opts.repo))
  const maxFiles = Math.max(1, opts.maxFiles ?? 60)
  const maxBytes = Math.max(1024, opts.maxBytes ?? 512 * 1024)

  const hubSet = new Set(report.architecture.importHubs.map((hub) => hub.path))
  const testSet = new Set(report.tests.files)
  const previous = new Set((opts.previousFailures ?? []).map((file) => file.replace(/^\.\//, "")))
  const recent = opts.report ? new Map<string, number>() : await recentFiles(opts.repo, 80)

  // Score every file in the repository; import hubs act as a proximity signal.
  const candidates = new Map<string, Scored>()
  const allFiles = await listFiles(opts.repo)

  for (const file of allFiles) {
    const lower = file.toLowerCase()
    const segments = lower.split(/[/]/)
    const scored: Scored = { file, score: 0, reasons: new Set() }

    for (const token of tokens) {
      const base = segments[segments.length - 1] ?? ""
      if (base.includes(token)) {
        scored.score += 5
        scored.reasons.add(`name:${token}`)
        continue
      }
      if (lower.includes(`/${token}/`)) {
        scored.score += 3
        scored.reasons.add(`dir:${token}`)
        continue
      }
      if (lower.includes(`/${token}.`)) {
        scored.score += 2
        scored.reasons.add(`stem:${token}`)
      }
    }

    if (hubSet.has(file) && scored.score > 0) {
      scored.score += 1
      scored.reasons.add("import-hub")
    }

    // Recency only boosts files that already matched the query; a recently
    // touched file with no lexical match is not contextually relevant.
    const recentRank = recent.get(file)
    if (recentRank !== undefined && scored.score > 0) {
      scored.score += recentRank < 20 ? 3 : recentRank < 50 ? 2 : 1
      scored.reasons.add("recent-change")
    }

    if (previous.has(file)) {
      scored.score += 4
      scored.reasons.add("previous-failure")
    }

    candidates.set(file, scored)
  }

  // Test relevance: a test file matching the same stem as a matched source
  // file is pulled next to it.
  for (const test of testSet) {
    const stem = path.basename(test).replace(/\.(test|spec)\.[jt]sx?$/, "")
    const matched = [...candidates.values()].filter(
      (entry) =>
        entry.score > 0 && path.basename(entry.file).replace(/\.[^.]+$/, "") === stem && !testSet.has(entry.file),
    )
    if (matched.length === 0) continue
    const entry = candidates.get(test) ?? { file: test, score: 0, reasons: new Set<string>() }
    entry.score += 4
    entry.reasons.add(`tests:${stem}`)
    candidates.set(test, entry)
  }

  // Group into priority buckets (first match wins per entry):
  //   0 direct source matches (non-test) — what the task is about
  //   1 import-hub neighbors of direct matches
  //   2 test files (own query match or pulled by a matched source stem)
  //   3 everything else with a positive score (e.g. previous failures)
  const positive = [...candidates.values()].filter((entry) => entry.score > 0)
  const isDirect = (entry: Scored) => [...entry.reasons].some((reason) => /^(name|dir|stem):/.test(reason))
  const bucket = (entry: Scored) => {
    if (isDirect(entry) && !testSet.has(entry.file)) return 0
    if (!isDirect(entry) && entry.reasons.has("import-hub")) return 1
    if (testSet.has(entry.file) || [...entry.reasons].some((reason) => reason.startsWith("tests:"))) return 2
    return 3
  }

  const seen = new Set<string>()
  const ordered = positive
    .sort((a, b) => bucket(a) - bucket(b) || b.score - a.score || a.file.localeCompare(b.file))
    .filter((entry) => {
      if (seen.has(entry.file)) return false
      seen.add(entry.file)
      return true
    })

  // Fit into the byte budget: candidates exceeding the remaining budget are
  // skipped (never the whole selection — if nothing fits at all we still
  // return the single best file rather than nothing).
  const result: Ranked[] = []
  let budget = maxBytes
  for (const entry of ordered) {
    if (result.length >= maxFiles) break
    const size = Bun.file(path.join(opts.repo, entry.file)).size
    if (size > budget) continue
    budget -= size
    result.push({ file: entry.file, score: entry.score, reasons: [...entry.reasons] })
  }
  if (result.length === 0 && ordered[0]) {
    const first = ordered[0]
    result.push({ file: first.file, score: first.score, reasons: [...first.reasons] })
  }

  return result
}

export type Snapshot = {
  task?: string
  query: string
  createdAt: string
  files: Ranked[]
}

/** Rank and persist the selection so downstream agents share one context view. */
export async function snapshot(opts: RankOptions): Promise<Snapshot> {
  const files = await rank(opts)
  const snap: Snapshot = { task: opts.task, query: opts.query, createdAt: new Date().toISOString(), files }
  await ensureState(opts.repo, "context")
  await Bun.write(
    path.join(stateDir(opts.repo, "context"), `${slug(opts.task ?? "context")}.json`),
    JSON.stringify(snap, null, 2) + "\n",
  )
  await emit(opts.repo, {
    event: "context.selected",
    task: opts.task,
    data: { query: opts.query, files: files.length, top: files.slice(0, 5).map((entry) => entry.file) },
  })
  return snap
}

/** Rank file paths against a free-text query without a repository scan — pure ranking for tests and fallbacks. */
export function rankPaths(files: string[], query: string, opts: { maxFiles?: number } = {}): Ranked[] {
  const tokens = tokenize(query)
  const maxFiles = Math.max(1, opts.maxFiles ?? 60)
  return files
    .map((file) => {
      const lower = file.toLowerCase()
      const segments = lower.split("/")
      let score = 0
      const reasons: string[] = []
      for (const token of tokens) {
        const base = segments[segments.length - 1] ?? ""
        if (base.includes(token)) {
          score += 5
          reasons.push(`name:${token}`)
          continue
        }
        if (lower.includes(`/${token}/`)) {
          score += 3
          reasons.push(`dir:${token}`)
          continue
        }
        if (lower.includes(`/${token}.`)) {
          score += 2
          reasons.push(`stem:${token}`)
        }
      }
      return { file, score, reasons }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, maxFiles)
}
