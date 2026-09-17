import { z } from "zod"
import { create, run, summary, type Executor, type Graph, type RunOptions } from "./graph"

/**
 * Agent manager / dynamic agent teams (roadmap §1, enabled by §19).
 *
 * A manager receives a task, decomposes it into a dependency-ordered plan of
 * role assignments, and runs it through the execution graph (§2). The manager
 * decides which roles are actually needed instead of always spawning the
 * same agents.
 *
 * Decomposition is pluggable: production use can wire an LLM-backed
 * `Decomposer`; the built-in default is a deterministic heuristic planner so
 * every behavior here is testable offline.
 */

/** Catalog of built-in roles with the keywords that make them relevant. */
export const ROLES: Record<string, { description: string; keywords: string[] }> = {
  explorer: { description: "map the codebase areas the task touches", keywords: [] },
  architect: {
    description: "decide the technical approach and interfaces",
    keywords: ["design", "architecture", "refactor", "migrate", "schema", "redesign"],
  },
  backend: {
    description: "implement server-side and core logic",
    keywords: ["api", "server", "database", "db", "backend", "endpoint", "service", "auth"],
  },
  frontend: {
    description: "implement user interface changes",
    keywords: ["ui", "frontend", "css", "component", "screen", "page", "button", "theme"],
  },
  tester: { description: "write and run tests", keywords: ["test", "tests", "coverage", "regression", "e2e"] },
  security: {
    description: "review for security issues",
    keywords: [
      "security",
      "auth",
      "token",
      "tokens",
      "secret",
      "secrets",
      "permission",
      "permissions",
      "vulnerability",
      "oauth",
    ],
  },
  reviewer: { description: "final independent review", keywords: [] },
  integrator: { description: "integrate all changes and run the full verification", keywords: [] },
}

export const Assignment = z.object({
  role: z.string().min(1),
  task: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  run: z.unknown().optional(),
})
export type Assignment = z.infer<typeof Assignment>

export const Plan = z.object({
  summary: z.string().min(1),
  assignments: z.array(Assignment).min(1),
})
export type Plan = z.infer<typeof Plan>

export type Decomposer = (task: string, ctx: { roles: typeof ROLES }) => Promise<Plan> | Plan

/**
 * Deterministic heuristic decomposition: always explore first, integrate
 * last, review near the end; spawn builder roles only when their keywords
 * appear in the task. This mirrors the "decide which roles are actually
 * needed" requirement without requiring a model.
 */
export function decomposeHeuristic(task: string): Plan {
  const tokens = new Set(task.toLowerCase().split(/[^a-z0-9]+/))
  const wanted = (role: string) => ROLES[role]?.keywords.some((keyword) => tokens.has(keyword)) ?? false

  const assignments: Assignment[] = [{ role: "explorer", task: `Explore the repository for: ${task}`, dependsOn: [] }]
  if (wanted("architect"))
    assignments.push({ role: "architect", task: `Architecture for: ${task}`, dependsOn: ["explorer"] })

  const builders: Assignment[] = []
  if (wanted("backend"))
    builders.push({ role: "backend", task: `Backend implementation: ${task}`, dependsOn: ["explorer"] })
  if (wanted("frontend"))
    builders.push({ role: "frontend", task: `Frontend implementation: ${task}`, dependsOn: ["explorer"] })
  if (builders.length === 0) {
    // No specialist keywords matched — fall back to a single general builder.
    builders.push({ role: "backend", task: `Implementation: ${task}`, dependsOn: ["explorer"] })
  }
  assignments.push(...builders)

  const testerDepends = builders.map((assignment) => assignment.role)
  if (wanted("tester")) assignments.push({ role: "tester", task: `Tests for: ${task}`, dependsOn: testerDepends })
  if (wanted("security"))
    assignments.push({ role: "security", task: `Security review: ${task}`, dependsOn: testerDepends })

  assignments.push({
    role: "reviewer",
    task: `Final review: ${task}`,
    dependsOn: assignments.filter((a) => a.role !== "explorer").map((a) => a.role),
  })
  assignments.push({ role: "integrator", task: `Integrate and verify: ${task}`, dependsOn: ["reviewer"] })

  return { summary: task, assignments }
}

export async function decompose(task: string, decomposer?: Decomposer): Promise<Plan> {
  if (!decomposer) return decomposeHeuristic(task)
  const plan = await decomposer(task, { roles: ROLES })
  const parsed = Plan.safeParse(plan)
  if (!parsed.success) throw new Error(`invalid manager plan: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`)
  return parsed.data
}

/**
 * Convert a plan into an execution graph. Each role may be assigned at most
 * once, so assignment roles double as node ids (a manager that needs two
 * parallel workers for the same specialty should mint distinct roles, e.g.
 * "backend-api" and "backend-worker").
 */
export function graphOf(taskName: string, plan: Plan): Graph {
  const roles = plan.assignments.map((assignment) => assignment.role)
  const duplicate = roles.find((role, index) => roles.indexOf(role) !== index)
  if (duplicate) throw new Error(`plan assigns role ${JSON.stringify(duplicate)} more than once`)

  for (const assignment of plan.assignments) {
    for (const dep of assignment.dependsOn) {
      if (!roles.includes(dep)) {
        throw new Error(
          `assignment ${JSON.stringify(assignment.role)} depends on unassigned role ${JSON.stringify(dep)}`,
        )
      }
    }
  }

  return create(
    taskName,
    plan.assignments.map((assignment) => ({
      id: assignment.role,
      description: assignment.task,
      dependencies: assignment.dependsOn,
      agent: assignment.role,
      run: assignment.run,
    })),
  )
}

export async function manage(opts: {
  repo: string
  taskName: string
  task: string
  decomposer?: Decomposer
  executor: Executor
  run?: RunOptions
}): Promise<{ plan: Plan; graph: Graph }> {
  const plan = await decompose(opts.task, opts.decomposer)
  const graph = graphOf(opts.taskName, plan)
  const finished = await run(opts.repo, graph, opts.executor, opts.run)
  return { plan, graph: finished }
}

export function report(graph: Graph) {
  return {
    ...summary(graph),
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      agent: node.agent,
      status: node.status,
      attempts: node.attempts,
      error: node.error,
    })),
  }
}
