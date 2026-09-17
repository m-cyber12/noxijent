// Dynamic agent teams (roadmap §1 / Phase 4 #19): orchestrate a manager plan
// as a live team — each role is driven by its own agent function, and when a
// role fails the team escalates the node to the next candidate role instead
// of dying midway. Escalations and outcomes are recorded as events so the
// run can be audited in the flight recorder and replayed later.

import { emit as emitEvent } from "./events"
import * as Graph from "./graph"
import * as Manager from "./manager"

export type AgentFn = (node: Graph.Node, ctx: { repo: string; task: string; role: string }) => Promise<unknown>

export type Escalation = { node: string; from: string; to: string; reason: string }

export type TeamResult = {
  task: string
  ok: boolean
  escalations: Escalation[]
  graph: Graph.Graph
  report: ReturnType<typeof Manager.report>
}

/**
 * Execute a task as a dynamic team.
 *
 * - `agents`: role → implementation (must cover every planned role)
 * - `alternates`: role → fallback roles tried in order on failure
 * - `maxNodeEscalations`: per-node escalation budget (default 2)
 */
export async function execute(
  repo: string,
  input: {
    task: string
    agents: Record<string, AgentFn>
    alternates?: Record<string, string[]>
    decomposer?: Manager.Decomposer
    maxNodeEscalations?: number
    maxParallel?: number
  },
): Promise<TeamResult> {
  const plan = await Manager.decompose(input.task, input.decomposer)
  const graph = Manager.graphOf(input.task, plan)
  const candidates = new Map<string, string[]>()
  for (const assignment of plan.assignments) {
    candidates.set(assignment.role, [assignment.role, ...(input.alternates?.[assignment.role] ?? [])])
  }

  const escalations: Escalation[] = []
  const depth = new Map<string, number>()
  const maxDepth = input.maxNodeEscalations ?? 2

  for (const role of candidates.keys()) {
    if (!input.agents[role]) throw new Error(`no agent registered for planned role ${JSON.stringify(role)}`)
  }

  // Run rounds: Graph.run settles failures, we re-arm nodes that still have
  // escalation headroom, then run again. The guard is a last-resort belt —
  // escalation budgets already bound re-arms, but never loop unbounded.
  let rounds = 0
  while (rounds++ < 50) {
    await Graph.run(repo, graph, executorFor(repo, input.task, input.agents), { concurrency: input.maxParallel ?? 2 })

    const failed = graph.nodes.filter((node) => node.status === "failed")
    if (failed.length === 0) break

    let progressed = false
    for (const node of failed) {
      // Manager ids nodes by their role, so node.id is always the original
      // role even after node.agent has been escalated.
      const chain = candidates.get(node.id) ?? []
      const used = depth.get(node.id) ?? 0
      const next = used + 1 < chain.length && used < maxDepth ? chain[used + 1] : undefined
      if (!next || !input.agents[next]) continue
      const previous = node.agent
      depth.set(node.id, used + 1)
      node.agent = next
      node.startedAt = undefined
      node.finishedAt = undefined
      // Re-arm the node and every dependent (skipped is terminal without a
      // cascade reset, so downstream work would never re-run).
      Graph.reset(graph, node.id, { cascade: true })
      escalations.push({ node: node.id, from: previous, to: next, reason: "previous role failed" })
      await emitEvent(repo, {
        event: "team.escalated",
        task: input.task,
        data: { node: node.id, from: previous, to: next },
      })
      progressed = true
    }
    if (!progressed) break
  }

  await Graph.save(repo, graph)
  const ok = graph.nodes.every((node) => node.status === "done")
  await emitEvent(repo, {
    event: ok ? "team.completed" : "team.failed",
    task: input.task,
    data: { nodes: graph.nodes.length, escalations: escalations.length },
  })
  return { task: input.task, ok, escalations, graph, report: Manager.report(graph) }
}

function executorFor(repo: string, task: string, agents: Record<string, AgentFn>): Graph.Executor {
  return async (node, ctx) => {
    const role = node.agent
    const agent = agents[role]
    if (!agent) throw new Error(`no agent registered for role ${JSON.stringify(role)}`)
    return agent(node, { repo: ctx.repo, task, role })
  }
}
