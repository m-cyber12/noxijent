// Local model routing (roadmap §20 / Phase 4 #20): pick the right locally
// available model for a task — complexity, context size, latency and cost
// drive the choice, project config wins over built-in defaults. Pure and
// offline: no runtime dependency on any paid service.

import path from "path"
import { z } from "zod"
import * as Manager from "./manager"

export const STRENGTHS = [
  "reasoning",
  "coding",
  "fast-edit",
  "security",
  "review",
  "long-context",
  "multimodal",
] as const
export type Strength = (typeof STRENGTHS)[number]

export const Model = z.object({
  name: z.string().min(1),
  /** capability tier 1 (weakest) .. 5 (strongest) */
  tier: z.number().int().min(1).max(5),
  costTier: z.number().int().min(1).max(3),
  /** 1 = fastest, 3 = slowest */
  latencyTier: z.number().int().min(1).max(3),
  contextWindow: z.number().int().positive(),
  strengths: z.array(z.enum(STRENGTHS)).default([]),
})
export type Model = z.infer<typeof Model>

export const DEFAULT_CATALOG: Model[] = [
  { name: "tiny-model", tier: 1, costTier: 1, latencyTier: 1, contextWindow: 8_192, strengths: ["fast-edit"] },
  {
    name: "local-fast-model",
    tier: 2,
    costTier: 1,
    latencyTier: 1,
    contextWindow: 32_768,
    strengths: ["fast-edit", "coding"],
  },
  { name: "coding-model", tier: 3, costTier: 2, latencyTier: 2, contextWindow: 131_072, strengths: ["coding"] },
  {
    name: "security-model",
    tier: 4,
    costTier: 2,
    latencyTier: 2,
    contextWindow: 131_072,
    strengths: ["security", "review"],
  },
  {
    name: "reasoning-model",
    tier: 5,
    costTier: 3,
    latencyTier: 3,
    contextWindow: 262_144,
    strengths: ["reasoning", "review"],
  },
  {
    name: "long-context-model",
    tier: 3,
    costTier: 3,
    latencyTier: 3,
    contextWindow: 1_048_576,
    strengths: ["long-context", "coding"],
  },
]

const CATALOG_FILE = path.join(".noxijent", "models.json")

/** Project overrides/extends the built-in catalog via `.noxijent/models.json`. */
export async function catalog(repo: string): Promise<Model[]> {
  const text = await Bun.file(path.join(repo, CATALOG_FILE))
    .text()
    .catch(() => "")
  if (!text.trim()) return [...DEFAULT_CATALOG]
  let parsed: { models?: Model[] }
  try {
    parsed = z.object({ models: z.array(Model).min(1) }).parse(JSON.parse(text))
  } catch (error) {
    throw new Error(`invalid .noxijent/models.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const merged = new Map(DEFAULT_CATALOG.map((model) => [model.name, model]))
  for (const model of parsed.models!) merged.set(model.name, model)
  return [...merged.values()]
}

// Hint order is the precedence when several classes match: design intent
// beats security words, security beats generic review words, and size cues
// beat small-edit ones.
const TASK_STRENGTH_HINTS: Array<{ strength: Strength; keywords: string[] }> = [
  {
    strength: "reasoning",
    keywords: ["design", "architect", "refactor", "plan", "migrate", "redesign", "tradeoff", "evaluate"],
  },
  {
    strength: "security",
    keywords: ["security", "auth", "token", "password", "xss", "injection", "secret", "vulnerability"],
  },
  { strength: "review", keywords: ["review", "audit", "inspect", "verify", "assess"] },
  { strength: "long-context", keywords: ["whole repo", "entire codebase", "every file", "monorepo", "all modules"] },
  { strength: "fast-edit", keywords: ["rename", "typo", "quick", "small", "tweak", "fix typo", "one-liner", "bump"] },
]

/** The strength a task most needs, based on its text. */
export function strengthFor(task: string): Strength {
  const lower = task.toLowerCase()
  for (const hint of TASK_STRENGTH_HINTS) {
    if (hint.keywords.some((keyword) => lower.includes(keyword))) return hint.strength
  }
  return "coding"
}

/** Agent-role → strength mapping used when routing whole team roles. */
export function strengthForRole(role: string): Strength {
  const map: Record<string, Strength> = {
    explorer: "long-context",
    architect: "reasoning",
    backend: "coding",
    frontend: "coding",
    tester: "coding",
    security: "security",
    reviewer: "review",
    integrator: "reasoning",
  }
  return map[role] ?? "coding"
}

export type Constraints = {
  prefer?: "cost" | "latency" | "quality"
  maxCostTier?: number
  minTier?: number
  /** estimated prompt/context size the model must fit */
  contextSize?: number
  /** force the required strength instead of inferring it from the task text */
  strength?: Strength
}

export type Choice = {
  model: Model
  strength: Strength
  reasons: string[]
  /** ranked remaining options, best first */
  alternatives: Model[]
}

/**
 * Choose a model. Balanced default: tier + 4×strength match − costTier −
 * latencyTier, so an expensive model only wins when the task actually needs
 * it. With prefer=quality tiers dominate (+2×tier); prefer=cost/latency
 * applies a strong −4× penalty that overrides capability gaps. Ties break
 * by name for determinism. Throws when no model satisfies the constraints.
 */
export function choose(models: Model[], task: string, opts: Constraints = {}): Choice {
  if (models.length === 0) throw new Error("empty model catalog")
  const strength = opts.strength ?? strengthFor(task)

  const fitting = models.filter((model) => {
    if (opts.minTier !== undefined && model.tier < opts.minTier) return false
    if (opts.maxCostTier !== undefined && model.costTier > opts.maxCostTier) return false
    if (opts.contextSize !== undefined && model.contextWindow < opts.contextSize) return false
    return true
  })
  if (fitting.length === 0) throw new Error("no model satisfies the constraints")

  const prefer = opts.prefer
  const ranked = fitting
    .map((model) => {
      let score = model.tier
      const reasons: string[] = [`tier ${model.tier}`]
      if (model.strengths.includes(strength)) {
        score += 4
        reasons.push(`strong at ${strength}`)
      }
      if (strength === "long-context" && opts.contextSize !== undefined && model.contextWindow >= opts.contextSize)
        reasons.push(`fits ${opts.contextSize} tokens`)
      if (prefer === "quality") {
        score += model.tier * 2
        reasons.push("quality-preferred")
      } else if (prefer === "cost") {
        score -= model.costTier * 4
        reasons.push(`cost-optimized (tier ${model.costTier})`)
      } else if (prefer === "latency") {
        score -= model.latencyTier * 4
        reasons.push(`latency-optimized (tier ${model.latencyTier})`)
      } else {
        score -= model.costTier + model.latencyTier
      }
      return { model, score, reasons }
    })
    .sort((a, b) => b.score - a.score || a.model.name.localeCompare(b.model.name))

  const best = ranked[0]!
  return {
    model: best.model,
    strength,
    reasons: [`task calls for ${strength}`, ...best.reasons],
    alternatives: ranked.slice(1).map((entry) => entry.model),
  }
}

/** Route a task against the repository's merged catalog. */
export async function route(repo: string, task: string, opts: Constraints = {}): Promise<Choice> {
  return choose(await catalog(repo), task, opts)
}

/** Route a manager role against the repository's merged catalog. */
export async function routeRole(repo: string, role: string, opts: Constraints = {}): Promise<Choice> {
  if (!Manager.ROLES[role]) throw new Error(`unknown role ${JSON.stringify(role)}`)
  const strength = strengthForRole(role)
  const choice = choose(await catalog(repo), role, { ...opts, strength })
  return { ...choice, reasons: [`role ${role} calls for ${strength}`, ...choice.reasons.slice(1)] }
}
