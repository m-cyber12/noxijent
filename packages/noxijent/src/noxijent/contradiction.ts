import path from "path"
import { z } from "zod"

/**
 * Contradiction detector (roadmap §7).
 *
 * Agents often blindly follow instructions even when the repository itself
 * contradicts them. Before major changes, this runs a lightweight consistency
 * analysis over project instructions, README, package configuration, CI
 * configuration, and source layout, and reports conflicts with evidence.
 *
 * Every rule is a pure mapping from the collected facts to findings, so the
 * detector is fully testable offline.
 */

export const SEVERITY = ["info", "warning", "error"] as const
export type Severity = (typeof SEVERITY)[number]

export const Finding = z.object({
  rule: z.string(),
  severity: z.enum(SEVERITY),
  summary: z.string(),
  evidence: z.array(z.object({ source: z.string(), detail: z.string() })),
})
export type Finding = z.infer<typeof Finding>

export type Facts = {
  instructionFiles: Array<{ path: string; text: string }>
  readmeFiles: Array<{ path: string; text: string }>
  packageJson: { path: string; text: string } | undefined
  packageManagerField: string | undefined
  lockfiles: string[]
  ciFiles: Array<{ path: string; text: string }>
  hasGraphQL: boolean
  scripts: Record<string, string>
  nodeVersionFiles: Array<{ path: string; version: string }>
}

const PM_KEYWORDS: Array<{ name: string; command: RegExp; lockfile: string; field: string }> = [
  { name: "pnpm", command: /\bpnpm\b/, lockfile: "pnpm-lock.yaml", field: "pnpm@" },
  { name: "yarn", command: /\byarn\b/, lockfile: "yarn.lock", field: "yarn@" },
  { name: "npm", command: /\bnpm (ci|install|run|test)\b/, lockfile: "package-lock.json", field: "npm@" },
  { name: "bun", command: /\bbun (install|run|test|x)\b|\bbunfig\.toml\b/, lockfile: "bun.lock", field: "bun@" },
]

const INSTRUCTION_NAMES = new Set(["agents.md", "claude.md", "cursorrules", "contributing.md"])

async function readIfExists(repo: string, rel: string) {
  const text = await Bun.file(path.join(repo, rel))
    .text()
    .catch(() => "")
  return text || undefined
}

export async function collect(repo: string): Promise<Facts> {
  const glob = new Bun.Glob("**/*")
  const instructionFiles: Facts["instructionFiles"] = []
  const readmeFiles: Facts["readmeFiles"] = []
  const ciFiles: Facts["ciFiles"] = []
  const lockfiles: string[] = []
  const nodeVersionFiles: Facts["nodeVersionFiles"] = []
  let hasGraphQL = false
  let packageJson: Facts["packageJson"]

  for await (const entry of glob.scan({ cwd: repo, absolute: false, dot: true, followSymlinks: false })) {
    if (
      entry.split("/").some((segment) => ["node_modules", ".git", "dist", "build", "out", "target"].includes(segment))
    )
      continue
    if (entry.startsWith(".noxijent/state/")) continue
    const base = path.basename(entry).toLowerCase()

    if (
      (base === "agents.md" || base === "claude.md" || base === "contributing.md" || base === ".cursorrules") &&
      INSTRUCTION_NAMES.has(base)
    ) {
      const text = await readIfExists(repo, entry)
      if (text) instructionFiles.push({ path: entry, text })
    }
    if (base === "readme.md" || base === "readme") {
      const text = await readIfExists(repo, entry)
      if (text) readmeFiles.push({ path: entry, text })
    }
    if (entry.startsWith(".github/workflows/") && /\.(yml|yaml)$/.test(entry)) {
      const text = await readIfExists(repo, entry)
      if (text) ciFiles.push({ path: entry, text })
    }
    if (entry === ".gitlab-ci.yml") {
      const text = await readIfExists(repo, entry)
      if (text) ciFiles.push({ path: entry, text })
    }
    for (const pm of PM_KEYWORDS) {
      if (base === pm.lockfile.toLowerCase() && !lockfiles.includes(entry)) lockfiles.push(entry)
    }
    if (base === ".nvmrc" || base === ".node-version") {
      const text = await readIfExists(repo, entry)
      if (text?.trim()) nodeVersionFiles.push({ path: entry, version: text.trim() })
    }
    if (entry === "package.json" || entry.endsWith("/package.json")) {
      if (entry === "package.json") {
        const text = await readIfExists(repo, entry)
        if (text) packageJson = { path: entry, text }
      }
    }
    if (entry.endsWith(".graphql") || entry.endsWith(".gql")) hasGraphQL = true
  }

  const manifest = packageJson?.text ? (JSON.parse(packageJson.text) as Record<string, unknown>) : undefined
  const scripts = (manifest?.scripts ?? {}) as Record<string, string>
  const packageManagerField = typeof manifest?.packageManager === "string" ? manifest.packageManager : undefined

  return {
    instructionFiles,
    readmeFiles,
    packageJson,
    packageManagerField,
    lockfiles,
    ciFiles,
    hasGraphQL,
    scripts,
    nodeVersionFiles,
  }
}

type Rule = (facts: Facts) => Finding[]

function mentionsPackageManager(text: string): string[] {
  const found: string[] = []
  if (PM_KEYWORDS[0].command.test(text)) found.push("pnpm")
  if (PM_KEYWORDS[1].command.test(text)) found.push("yarn")
  if (PM_KEYWORDS[2].command.test(text)) found.push("npm")
  if (PM_KEYWORDS[3].command.test(text)) found.push("bun")
  return found
}

// Instruction files (AGENTS.md & friends) declare tools in prose — "Use bun
// for everything" — so bare word mentions count there.
function mentionsInInstructions(text: string): string[] {
  return PM_KEYWORDS.filter((pm) => new RegExp(`\\b${pm.name}\\b`, "i").test(text)).map((pm) => pm.name)
}

function pmFromField(field: string | undefined): string | undefined {
  if (!field) return undefined
  for (const pm of PM_KEYWORDS) {
    if (field.startsWith(pm.field) || field === pm.name) return pm.name
  }
  return undefined
}

function pmFromLockfiles(lockfiles: string[]): string[] {
  const names = new Set<string>()
  for (const file of lockfiles) {
    for (const pm of PM_KEYWORDS) {
      if (path.basename(file).toLowerCase() === pm.lockfile.toLowerCase()) names.add(pm.name)
    }
  }
  return [...names]
}

const packageManagerRule: Rule = (facts) => {
  const findings: Finding[] = []
  const declared = new Set<string>()
  const evidence = new Map<string, Array<{ source: string; detail: string }>>()
  const say = (pm: string, source: string, detail: string) => {
    declared.add(pm)
    const list = evidence.get(pm) ?? []
    list.push({ source, detail })
    evidence.set(pm, list)
  }

  for (const file of facts.instructionFiles) {
    for (const pm of mentionsInInstructions(file.text)) {
      if (new RegExp(`use ${pm}|with ${pm}|via ${pm}|\`${pm}`, "i").test(file.text))
        say(pm, file.path, "project instructions mention this package manager")
    }
  }
  const field = pmFromField(facts.packageManagerField)
  if (field) say(field, facts.packageJson!.path, `packageManager: ${facts.packageManagerField}`)
  for (const pm of pmFromLockfiles(facts.lockfiles)) say(pm, facts.lockfiles.join(", "), "lockfile present")
  for (const file of facts.ciFiles) {
    for (const pm of mentionsPackageManager(file.text)) say(pm, file.path, "CI installs/runs with this package manager")
  }

  if (declared.size <= 1) return findings

  for (const file of facts.instructionFiles) {
    const mentioned = mentionsInInstructions(file.text).filter((pm) =>
      new RegExp(`use ${pm}|\`${pm}`, "i").test(file.text),
    )
    for (const pm of mentioned) {
      const others = [...declared].filter((other) => other !== pm)
      if (others.length === 0) continue
      findings.push({
        rule: "package-manager-conflict",
        severity: "warning",
        summary: `possible package manager conflict: instructions say ${pm}, but evidence also points to ${others.join(", ")}`,
        evidence: [
          { source: file.path, detail: `instructions reference ${pm}` },
          ...others.flatMap((other) => evidence.get(other) ?? []),
        ],
      })
    }
  }
  return findings
}

const nodeVersionRule: Rule = (facts) => {
  const findings: Finding[] = []
  const versions = new Map<string, string[]>()
  for (const file of facts.nodeVersionFiles) {
    const major = file.version.replace(/^v/, "").split(".")[0]
    if (major) versions.set(major, [...(versions.get(major) ?? []), file.path])
  }

  const manifest = facts.packageJson?.text ? (JSON.parse(facts.packageJson.text) as Record<string, unknown>) : undefined
  const engines = (manifest?.engines as Record<string, string> | undefined)?.node
  if (engines) {
    for (const file of facts.nodeVersionFiles) {
      const major = file.version.replace(/^v/, "").split(".")[0]
      const wanted = engines.match(/(\d+)/)?.[1]
      if (major && wanted && major !== wanted) {
        findings.push({
          rule: "node-version-conflict",
          severity: "info",
          summary: `node version mismatch: ${file.path} pins ${file.version.trim()} but package.json engines requires ${engines}`,
          evidence: [
            { source: file.path, detail: file.version.trim() },
            { source: facts.packageJson!.path, detail: `engines.node: ${engines}` },
          ],
        })
      }
    }
  }
  return findings
}

const apiStyleRule: Rule = (facts) => {
  const findings: Finding[] = []
  for (const file of [...facts.readmeFiles, ...facts.instructionFiles]) {
    const rest = /\bREST (API|api)\b|\bRESTful\b/i.test(file.text)
    if (!rest || !facts.hasGraphQL) continue
    findings.push({
      rule: "api-style-conflict",
      severity: "info",
      summary: `documentation may be outdated: ${file.path} describes a REST API but GraphQL schemas are present in the codebase`,
      evidence: [
        { source: file.path, detail: "mentions REST API" },
        { source: "codebase", detail: "contains .graphql/.gql files" },
      ],
    })
  }
  return findings
}

const testScriptRule: Rule = (facts) => {
  const testScript = facts.scripts.test
  if (!testScript) return []
  const scriptPms = mentionsPackageManager(testScript)
  if (scriptPms.length === 0) return []

  const findings: Finding[] = []
  for (const file of facts.ciFiles) {
    const testLine = /(bun|npm|pnpm|yarn)[^\n|]*\btest\b/i.exec(file.text)?.[0]
    if (!testLine) continue
    const ciPm = /(bun|npm|pnpm|yarn)/i.exec(testLine)?.[1]?.toLowerCase()
    if (!ciPm || scriptPms.includes(ciPm)) continue
    findings.push({
      rule: "test-runner-conflict",
      severity: "warning",
      summary: `possible test command mismatch: package.json test script uses ${scriptPms.join("/")} (${JSON.stringify(testScript)}) but CI runs tests with ${ciPm}`,
      evidence: [
        { source: facts.packageJson!.path, detail: `test script: ${testScript}` },
        { source: file.path, detail: `CI runs: ${testLine.trim()}` },
      ],
    })
  }
  return findings
}

export const RULES: Rule[] = [packageManagerRule, nodeVersionRule, apiStyleRule, testScriptRule]

export async function scan(repo: string, facts?: Facts): Promise<Finding[]> {
  const resolvedFacts = facts ?? (await collect(repo))
  return RULES.flatMap((rule) => rule(resolvedFacts)).sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 } as const
    return order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule)
  })
}
