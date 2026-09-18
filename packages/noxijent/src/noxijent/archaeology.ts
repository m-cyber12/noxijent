// Automatic code archaeology (roadmap §15 / Phase 3 #15): explain why a
// piece of code exists using Git history — blame, related commits, commit
// messages, and whether tests changed alongside it. Evidence-based, no
// speculation: the report lists the commits and authors that shaped the
// code so the agent can reason from facts.

export type BlameEntry = {
  commit: string
  author: string
  date: string
  line: number
}

export type HistoryEntry = {
  commit: string
  date: string
  author: string
  subject: string
}

export type Report = {
  file: string
  range: { from: number; to: number }
  authors: string[]
  commits: HistoryEntry[]
  subjects: string[]
  testsChanged: string[]
  boundaryCommit?: string
}

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${err.trim() || `exit ${code}`}`)
  return out
}

async function assertTracked(repo: string, file: string): Promise<void> {
  const listed = await git(repo, ["ls-files", "--error-unmatch", "--", file]).catch(() => "")
  if (!listed.trim()) throw new Error(`no git history for ${file} (not tracked, or ${repo} is not a git repository)`)
}

/** Blame a line range of a tracked file. */
export async function blame(
  repo: string,
  file: string,
  opts: { from?: number; to?: number } = {},
): Promise<BlameEntry[]> {
  await assertTracked(repo, file)
  const range =
    opts.from !== undefined || opts.to !== undefined ? ["-L", `${opts.from ?? 1},${opts.to ?? opts.from ?? 1}`] : []
  const text = await git(repo, ["blame", "--line-porcelain", ...range, "--", file])
  const entries: BlameEntry[] = []
  let current: Partial<BlameEntry> = {}
  for (const lineText of text.split("\n")) {
    const header = lineText.match(/^([0-9a-f]{40}|\^?[0-9a-f]{8,40}) \d+ (\d+)/)
    if (header) {
      current = { commit: header[1].replace(/^\^/, ""), line: Number(header[2]) }
      continue
    }
    if (lineText.startsWith("author ")) current.author = lineText.slice(7)
    if (lineText.startsWith("author-time ")) current.date = new Date(Number(lineText.slice(12)) * 1000).toISOString()
    if (lineText.startsWith("\t")) {
      if (current.commit && current.line !== undefined) {
        entries.push({
          commit: current.commit,
          author: current.author ?? "unknown",
          date: current.date ?? "",
          line: current.line,
        })
      }
      current = {}
    }
  }
  return entries
}

/** Commit history for a file (newest first), following renames. */
export async function history(repo: string, file: string, opts: { max?: number } = {}): Promise<HistoryEntry[]> {
  await assertTracked(repo, file)
  const max = Math.max(1, opts.max ?? 20)
  const text = await git(repo, [
    "log",
    "--follow",
    `--max-count=${max}`,
    "--pretty=format:%H%x1f%ad%x1f%an%x1f%s",
    "--date=iso-strict",
    "--",
    file,
  ])
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, date, author, ...subject] = line.split("\x1f")
      return { commit, date, author, subject: subject.join("\x1f") }
    })
}

/** Files changed by a commit. */
export async function touchedFiles(repo: string, commit: string): Promise<string[]> {
  const text = await git(repo, ["show", "--name-only", "--pretty=format:", commit])
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function isTest(file: string) {
  return /(?:^|[/])(__tests__|tests?)(?:[/]|$)|\.(test|spec)\.[jt]sx?$/.test(file)
}

/**
 * Build the archaeological report for a file (optionally a line range):
 * who shaped it, what they said, and which tests moved with it.
 */
export async function explain(
  repo: string,
  input: { file: string; from?: number; to?: number; maxCommits?: number },
): Promise<Report> {
  const entries = await blame(repo, input.file, { from: input.from, to: input.to })
  const first = entries[0]?.line ?? 1
  const last = entries[entries.length - 1]?.line ?? first
  const commits = await history(repo, input.file, { max: input.maxCommits ?? 10 })

  const authors = [...new Set(entries.map((entry) => entry.author))].sort()
  const subjects = [...new Set(commits.map((entry) => entry.subject))]

  const testsChanged: string[] = []
  for (const entry of commits.slice(0, 10)) {
    for (const touched of await touchedFiles(repo, entry.commit)) {
      if (isTest(touched) && !testsChanged.includes(touched)) testsChanged.push(touched)
    }
  }

  // The commit that introduced the oldest blamed line — usually where the
  // "weird" code was born.
  const boundaryHash = [...entries].sort((a, b) => a.date.localeCompare(b.date))[0]?.commit
  const boundaryCommit = boundaryHash ? commits.find((entry) => entry.commit === boundaryHash)?.subject : undefined

  return {
    file: input.file,
    range: { from: first, to: last },
    authors,
    commits,
    subjects,
    testsChanged: testsChanged.sort(),
    boundaryCommit,
  }
}

export function render(report: Report): string {
  const lines = [
    `Archaeology: ${report.file} (lines ${report.range.from}–${report.range.to})`,
    ``,
    `authors: ${report.authors.join(", ") || "none"}`,
    `commits touching this file: ${report.commits.length}`,
  ]
  if (report.boundaryCommit) lines.push(`oldest seen change: ${report.boundaryCommit}`)
  if (report.subjects.length > 0) {
    lines.push(``, "recent history:")
    for (const subject of report.subjects.slice(0, 10)) lines.push(`  • ${subject}`)
  }
  if (report.testsChanged.length > 0) {
    lines.push(``, "tests changed alongside:")
    for (const file of report.testsChanged) lines.push(`  • ${file}`)
  } else {
    lines.push(``, "no test changes observed alongside these commits")
  }
  return lines.join("\n")
}

/** Quick existence probe used by callers that tolerate non-git inputs. */
export async function hasHistory(repo: string, file: string): Promise<boolean> {
  return git(repo, ["ls-files", "--error-unmatch", "--", file])
    .then(() => true)
    .catch(() => false)
}
