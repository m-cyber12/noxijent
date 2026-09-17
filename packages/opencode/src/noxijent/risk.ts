import { parse } from "jsonc-parser"
import { z } from "zod"
import { root } from "./paths"

/**
 * Risk-based action policies (roadmap §19) and the human attention optimizer
 * foundation (§18).
 *
 * Every tool action gets a risk level:
 *
 *   read-only (low) → local mutation (medium) → destructive/external (high)
 *   → irreversible/production (critical)
 *
 * Policies map levels to decisions: `allow` (run silently), `ask` (interrupt
 * the human), or `deny` (never run autonomously). The point is fewer but more
 * meaningful interruptions: low-risk actions flow through, and attention is
 * spent on high-risk ones.
 *
 * Policies are configurable per repository via `.noxijent/risk.jsonc`:
 *
 *   {
 *     "policy": { "low": "allow", "medium": "ask", "high": "ask", "critical": "deny" },
 *     "overrides": [
 *       { "match": "bash:git status*", "level": "low" },
 *       { "match": "bash:rm *",        "level": "high" }
 *     ]
 *   }
 */

export const LEVELS = ["low", "medium", "high", "critical"] as const
export type Level = (typeof LEVELS)[number]

export const DECISIONS = ["allow", "ask", "deny"] as const
export type Decision = (typeof DECISIONS)[number]

export const Config = z.object({
  policy: z.partialRecord(z.enum(LEVELS), z.enum(DECISIONS)).default({}),
  overrides: z
    .array(
      z.object({
        match: z.string().min(1),
        level: z.enum(LEVELS),
        reason: z.string().optional(),
      }),
    )
    .default([]),
})
export type Config = z.infer<typeof Config>

export const DEFAULT_POLICY: Record<Level, Decision> = {
  low: "allow",
  medium: "ask",
  high: "ask",
  critical: "deny",
}

type Rule = { match: string; level: Level; reason: string }

/** Turn `bash:git status*` style glob text into a RegExp. Case-insensitive. */
export function glob(match: string) {
  const escaped = match
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "i")
}

/** Expand `{a,b,c}` alternation in glob text before compiling: "{ls,pwd}*" → ["ls*", "pwd*"]. */
function expandBraces(text: string): string[] {
  const start = text.indexOf("{")
  if (start === -1) return [text]
  const end = text.indexOf("}", start)
  if (end === -1) return [text]
  return text
    .slice(start + 1, end)
    .split(",")
    .flatMap((part) => expandBraces(text.slice(0, start) + part + text.slice(end + 1)))
}

// Ordered: first match wins per command segment. Keep specific patterns above
// generic ones.
const DEFAULT_RULES: Rule[] = [
  // Secrets and credentials are always at least high risk, even for reads.
  { match: "read:.env*", level: "high", reason: "environment file may contain secrets" },
  { match: "read:*.pem", level: "high", reason: "private key material" },
  { match: "read:*id_rsa*", level: "high", reason: "private key material" },
  { match: "bash:*.env*", level: "high", reason: "command references an environment file" },

  // Irreversible / destructive shell actions.
  { match: "bash:rm -rf /*", level: "critical", reason: "recursive delete at filesystem root" },
  { match: "bash:rm -rf ~*", level: "critical", reason: "recursive delete at home directory" },
  { match: "bash:*mkfs*", level: "critical", reason: "filesystem format" },
  { match: "bash:*dd *of=/dev/*", level: "critical", reason: "raw disk write" },
  { match: "bash:rm -rf *", level: "high", reason: "recursive delete" },
  { match: "bash:rm *", level: "high", reason: "file deletion" },
  { match: "bash:*sudo *", level: "high", reason: "privilege escalation" },
  { match: "bash:git push*--force*", level: "critical", reason: "history rewrite on remote" },
  { match: "bash:git push*", level: "high", reason: "publishes commits to a remote" },
  { match: "bash:git reset --hard*", level: "high", reason: "discards working tree changes" },
  { match: "bash:git clean -*f*", level: "high", reason: "deletes untracked files" },

  // External side effects.
  { match: "bash:curl*-X {post,put,delete,patch}*", level: "high", reason: "network write" },
  { match: "bash:*{vercel,netlify,flyctl}*deploy*", level: "critical", reason: "deployment" },
  { match: "bash:terraform apply*", level: "critical", reason: "infrastructure mutation" },
  { match: "bash:kubectl delete*", level: "critical", reason: "infrastructure mutation" },
  { match: "bash:npm publish*", level: "high", reason: "publishes an artifact" },

  // Local mutation.
  { match: "write:*", level: "medium", reason: "file creation" },
  { match: "edit:*", level: "medium", reason: "file modification" },
  { match: "patch:*", level: "medium", reason: "file modification" },
  { match: "bash:*install*", level: "medium", reason: "dependency installation" },
  { match: "bash:git commit*", level: "medium", reason: "commit" },
  { match: "bash:git add*", level: "low", reason: "staging changes" },

  // Read-only shell commands.
  {
    match:
      "bash:{ls,pwd,cat,head,tail,less,echo,printf,which,whoami,date,uname,find,tree,du,df,wc,file,stat,diff,sort,uniq,cd,git status,git diff,git log,git show,git branch,git rev-parse,git ls-files,git blame,bun test,bun run,bunx,npm test,pnpm test,yarn test,vitest,jest,tsc,tsgo,oxlint,eslint,biome,prettier}*",
    level: "low",
    reason: "read-only or local verification",
  },
  { match: "bash:*", level: "medium", reason: "unclassified shell command" },

  // Read-only tools.
  { match: "read:*", level: "low", reason: "read-only" },
  { match: "glob:*", level: "low", reason: "read-only" },
  { match: "grep:*", level: "low", reason: "read-only" },
  { match: "ls:*", level: "low", reason: "read-only" },
  { match: "list:*", level: "low", reason: "read-only" },
  { match: "lsp:*", level: "low", reason: "read-only" },
  { match: "webfetch:*", level: "low", reason: "network read" },
  { match: "todoread:*", level: "low", reason: "read-only" },
  { match: "todowrite:*", level: "low", reason: "task bookkeeping" },
  { match: "question:*", level: "low", reason: "user interaction" },
  { match: "task:*", level: "medium", reason: "spawns a child agent" },
]

const COMPILED: Array<{ pattern: RegExp; level: Level; reason: string }> = DEFAULT_RULES.flatMap((rule) =>
  expandBraces(rule.match).map((match) => ({ pattern: glob(match), level: rule.level, reason: rule.reason })),
)

const BARE_READ_TOOLS = [
  "read",
  "glob",
  "grep",
  "ls",
  "list",
  "lsp",
  "webfetch",
  "todoread",
  "todowrite",
  "question",
  "task",
]

function target(tool: string, input?: string) {
  const value = input?.trim()
  if (value) return `${tool}:${value}`
  if (BARE_READ_TOOLS.includes(tool)) return `${tool}:`
  return tool
}

/** Split compound shell commands so `ls && rm -rf x` is judged by its worst segment. */
function segments(key: string) {
  if (!key.startsWith("bash:")) return [key]
  const command = key.slice("bash:".length)
  const parts = command
    .split(/\n|&&|\|\||\||;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) return ["bash:"]
  return parts.map((part) => `bash:${part}`)
}

function levelRank(level: Level) {
  return LEVELS.indexOf(level)
}

export type Classification = { level: Level; reason: string; source: "default" | "override" | "fallback" }

function classifyOne(key: string, config?: Config): Classification {
  for (const override of config?.overrides ?? []) {
    for (const variant of expandBraces(override.match)) {
      if (glob(variant).test(key)) {
        return {
          level: override.level,
          reason: override.reason ?? `matched ${JSON.stringify(override.match)}`,
          source: "override",
        }
      }
    }
  }
  for (const rule of COMPILED) {
    if (rule.pattern.test(key)) return { level: rule.level, reason: rule.reason, source: "default" }
  }
  return { level: "medium", reason: "unclassified", source: "fallback" }
}

export function classify(tool: string, input?: string, config?: Config): Classification {
  const parts = segments(target(tool, input))
  const ranked = parts.map((part) => classifyOne(part, config))
  const worst = ranked.reduce((max, item) => (levelRank(item.level) > levelRank(max.level) ? item : max), ranked[0])
  return worst
}

export function decide(tool: string, input?: string, config?: Config): Classification & { decision: Decision } {
  const classification = classify(tool, input, config)
  const decision = config?.policy[classification.level] ?? DEFAULT_POLICY[classification.level]
  return { ...classification, decision }
}

export async function load(repo: string): Promise<Config | undefined> {
  for (const name of ["risk.jsonc", "risk.json"]) {
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
