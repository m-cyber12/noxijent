// Red-team reviewer (roadmap §16 / Phase 3 #13): independent adversarial
// review of a changeset. Deterministic rules scan added lines of a unified
// diff for bugs, secrets, risky patterns and missing tests — the reviewer
// the code author would not have been. Findings sort error→warning→info.

import { emit as emitEvent } from "./events"

export const SEVERITY = ["error", "warning", "info"] as const
export type Severity = (typeof SEVERITY)[number]

export type Finding = {
  rule: string
  severity: Severity
  file: string
  line?: number
  detail: string
}

export type Verdict = {
  ok: boolean
  files: number
  addedLines: number
  counts: Record<Severity, number>
  findings: Finding[]
}

type AddedLine = { file: string; line: number; text: string }

function isTestPath(file: string) {
  return /(?:^|[/])(__tests__|tests?)(?:[/]|$)|\.(test|spec)\.[jt]sx?$/.test(file)
}

/** Parse a unified diff into added lines with file and line numbers. */
export function parseAddedLines(diff: string): AddedLine[] {
  const lines = diff.split("\n")
  const result: AddedLine[] = []
  let file = ""
  let newLine = 0
  for (const raw of lines) {
    if (raw.startsWith("+++ ")) {
      file = raw
        .slice(4)
        .trim()
        .replace(/^[bc]\//, "")
      continue
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (raw.startsWith("+")) {
      if (file) result.push({ file, line: newLine, text: raw.slice(1) })
      newLine++
      continue
    }
    if (raw.startsWith("-")) continue
    newLine++
  }
  return result
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "private key material", regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: "aws access key", regex: /\b(AKIA|ASIA|AGPA|AIDA)[A-Z0-9]{16}\b/ },
  { name: "github token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: "hardcoded credential", regex: /(?:password|passwd|secret|api[-_]?key)\s*[:=]\s*["'][^"'\n]{8,}["']/i },
]

// Bidi control characters can visually smuggle code (CVE-2021-42574).
const BIDI = /[\u202A-\u202E\u2066-\u2069]/

export function preview(diff: string): Finding[] {
  const findings: Finding[] = []
  const added = parseAddedLines(diff)
  const files = new Set(added.map((entry) => entry.file))
  const testFiles = new Set([...files].filter(isTestPath))
  const sourceFiles = [...files].filter((file) => !isTestPath(file))

  for (const entry of added) {
    const { file, line, text } = entry
    if (isTestPath(file)) continue
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(text))
        findings.push({
          rule: "secret-pattern",
          severity: "error",
          file,
          line,
          detail: `possible ${pattern.name} committed to source`,
        })
    }
    if (BIDI.test(text))
      findings.push({
        rule: "unicode-smuggling",
        severity: "error",
        file,
        line,
        detail: "invisible bidi control characters in source",
      })
    if (/\bdebugger\b/.test(text))
      findings.push({
        rule: "debug-leftover",
        severity: "warning",
        file,
        line,
        detail: "debugger statement left in code",
      })
    if (/\bconsole\.(log|debug|trace)\b/.test(text))
      findings.push({ rule: "debug-leftover", severity: "warning", file, line, detail: "console output left in code" })
    if (/\beval\s*\(\s*[^)"]/.test(text))
      findings.push({
        rule: "risky-pattern",
        severity: "warning",
        file,
        line,
        detail: "eval() on a dynamic expression",
      })
    if (/\bdangerouslySetInnerHTML\b/.test(text))
      findings.push({
        rule: "risky-pattern",
        severity: "warning",
        file,
        line,
        detail: "inner HTML injection — verify sanitization",
      })
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(text) && !/\b(TODO|FIXME|HACK|XXX)\b\s*[:(]/.test(text))
      findings.push({
        rule: "todo-bomb",
        severity: "info",
        file,
        line,
        detail: "marker comment without any description",
      })
  }

  if (sourceFiles.length > 0 && testFiles.size === 0) {
    findings.push({
      rule: "missing-tests",
      severity: "warning",
      file: sourceFiles[0],
      detail: `${sourceFiles.length} source file(s) changed with no test file touched (${sourceFiles.slice(0, 3).join(", ")}${sourceFiles.length > 3 ? ", …" : ""})`,
    })
  }

  const additions = added.length
  const deletions = (diff.match(/^-(?!-)[^\n]*/gm) ?? []).length
  if (deletions > 0 && additions > 0 && deletions > additions * 3) {
    findings.push({
      rule: "regression-risk",
      severity: "info",
      file: [...files][0] ?? "",
      detail: `changeset mostly deletes code (${deletions} deletions vs ${additions} additions) — watch for removed behavior`,
    })
  }

  return findings.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 } as const
    return order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)
  })
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

/** Collect the diff under review: staged, working tree, or against a base ref. */
export async function diffOf(repo: string, opts: { staged?: boolean; base?: string } = {}): Promise<string> {
  if (opts.base) return git(repo, ["diff", opts.base, "--"])
  if (opts.staged) return git(repo, ["diff", "--cached"])
  return git(repo, ["diff", "HEAD", "--"])
}

/** Review a repository changeset and emit the verdict summary. */
export async function review(
  repo: string,
  opts: { staged?: boolean; base?: string; task?: string } = {},
): Promise<Verdict> {
  const diff = await diffOf(repo, opts)
  return verdict(repo, diff, opts.task)
}

/** Review an arbitrary diff (e.g. a generated patch) and emit the verdict. */
export async function verdict(repo: string, diff: string, task?: string): Promise<Verdict> {
  const findings = preview(diff)
  const added = parseAddedLines(diff)
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) counts[finding.severity]++
  const result: Verdict = {
    ok: counts.error === 0,
    files: new Set(added.map((entry) => entry.file)).size,
    addedLines: added.length,
    counts,
    findings,
  }
  await emitEvent(repo, { event: "redteam.reviewed", task, data: { ok: result.ok, ...counts } })
  return result
}
