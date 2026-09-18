import path from "path"
import { z } from "zod"
import { emit } from "./events"
import { ensureState, slug, stateDir } from "./paths"

/**
 * Execution graph / agent compiler (roadmap §2).
 *
 * A task becomes an explicit dependency graph of nodes instead of a linear
 * conversation. The graph gives the runtime dependency detection, parallelism,
 * per-node retries, progress tracking, resume-after-interruption and re-run
 * of individual nodes.
 *
 * The engine is model-free: a caller (agent manager, workflow engine, CLI)
 * supplies node definitions and an executor; the engine owns scheduling,
 * state transitions, retries and persistence so an interrupted run can
 * resume exactly where it stopped.
 */

export const STATUS = ["pending", "running", "done", "failed", "skipped"] as const
export type Status = (typeof STATUS)[number]

export const NodeInput = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  agent: z.string().min(1),
  /** opaque payload handed to the executor (e.g. a shell command or prompt) */
  run: z.unknown().optional(),
})
export type NodeInput = z.infer<typeof NodeInput>

export type Node = NodeInput & {
  status: Status
  attempts: number
  result?: unknown
  error?: string
  startedAt?: number
  finishedAt?: number
}

export type Graph = {
  task: string
  createdAt: number
  updatedAt: number
  nodes: Node[]
}

/** Validate node definitions and build the initial graph. */
export function create(task: string, inputs: NodeInput[]): Graph {
  if (inputs.length === 0) throw new Error("cannot build an execution graph with zero nodes")
  const ids = new Set<string>()
  for (const input of inputs) {
    if (ids.has(input.id)) throw new Error(`duplicate node id ${JSON.stringify(input.id)}`)
    ids.add(input.id)
  }
  for (const input of inputs) {
    for (const dep of input.dependencies) {
      if (!ids.has(dep))
        throw new Error(`node ${JSON.stringify(input.id)} depends on unknown node ${JSON.stringify(dep)}`)
      if (dep === input.id) throw new Error(`node ${JSON.stringify(input.id)} depends on itself`)
    }
  }
  layersOf(new Map(inputs.map((input) => [input.id, input.dependencies])))

  return {
    task,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nodes: inputs.map((input) => ({ ...input, status: "pending", attempts: 0 })),
  }
}

/** Topological layers: nodes within a layer only depend on earlier layers. */
export function layersOf(edges: Map<string, string[]>): string[][] {
  const indegree = new Map<string, number>()
  for (const [id, deps] of edges) indegree.set(id, deps.length)

  const layers: string[][] = []
  const placed = new Set<string>()
  while (placed.size < edges.size) {
    const layer = [...edges.entries()]
      .filter(([id, deps]) => !placed.has(id) && deps.every((dep) => placed.has(dep)))
      .map(([id]) => id)
    if (layer.length === 0) throw new Error("dependency cycle detected in execution graph")
    layers.push(layer)
    for (const id of layer) placed.add(id)
  }
  return layers
}

export function layers(graph: Graph): string[][] {
  return layersOf(new Map(graph.nodes.map((node) => [node.id, node.dependencies])))
}

/** Nodes that can start right now: pending with every dependency done. */
export function ready(graph: Graph): Node[] {
  const done = new Set(graph.nodes.filter((node) => node.status === "done").map((node) => node.id))
  return graph.nodes.filter((node) => node.status === "pending" && node.dependencies.every((dep) => done.has(dep)))
}

export function summary(graph: Graph) {
  const counts = new Map<Status, number>()
  for (const node of graph.nodes) counts.set(node.status, (counts.get(node.status) ?? 0) + 1)
  return {
    task: graph.task,
    total: graph.nodes.length,
    byStatus: Object.fromEntries(counts) as Partial<Record<Status, number>>,
    finished: graph.nodes.every((node) => node.status === "done" || node.status === "skipped"),
  }
}

export function file(repo: string, task: string) {
  return path.join(stateDir(repo, "graphs"), `${slug(task)}.json`)
}

export async function save(repo: string, graph: Graph): Promise<void> {
  await ensureState(repo, "graphs")
  graph.updatedAt = Date.now()
  await Bun.write(file(repo, graph.task), JSON.stringify(graph, null, 2) + "\n")
}

export async function load(repo: string, task: string): Promise<Graph | undefined> {
  const target = Bun.file(file(repo, task))
  if (!(await target.exists())) return undefined
  return (await target.json()) as Graph
}

export type Executor = (node: Node, ctx: { repo: string; task: string }) => Promise<unknown>

export type RunOptions = {
  concurrency?: number
  retries?: number
  signal?: AbortSignal
  /** how to treat remaining work after a node fails permanently: stop dependents only, or the whole run */
  onFailure?: "skip-dependents" | "abort"
}

/**
 * Execute a graph (or resume a partially executed one) and return it in its
 * final state. Nodes in the same dependency layer run concurrently.
 */
export async function run(repo: string, graph: Graph, executor: Executor, opts: RunOptions = {}): Promise<Graph> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const retries = Math.max(0, opts.retries ?? 0)
  const onFailure = opts.onFailure ?? "skip-dependents"

  // Crash-safe resume: nodes still "running" from a previous, interrupted
  // process go back to pending so the scheduler picks them up again.
  for (const node of graph.nodes) {
    if (node.status === "running") node.status = "pending"
  }

  const skipped = new Set<string>()
  const failed = (node: Node) => {
    node.finishedAt = Date.now()
    const dependents = graph.nodes.filter((other) => dependsOn(graph, other, node.id))
    for (const dependent of dependents) {
      if (dependent.status !== "pending") continue
      dependent.status = "skipped"
      skipped.add(dependent.id)
    }
    if (onFailure === "abort") {
      for (const other of graph.nodes) {
        if (other.status === "pending") other.status = "skipped"
      }
    }
  }

  async function attempt(node: Node): Promise<void> {
    node.status = "running"
    node.attempts++
    node.startedAt = Date.now()
    node.error = undefined
    await save(repo, graph)
    await emit(repo, {
      event: "graph.node.started",
      task: graph.task,
      agent: node.agent,
      data: { node: node.id, attempt: node.attempts },
    })

    const result = await executor(node, { repo, task: graph.task }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
    )

    if (result.ok) {
      node.status = "done"
      node.result = result.value
      node.finishedAt = Date.now()
      await emit(repo, {
        event: "graph.node.completed",
        task: graph.task,
        agent: node.agent,
        data: { node: node.id, attempt: node.attempts },
      })
      await save(repo, graph)
      return
    }

    node.error = result.error
    if (node.attempts <= retries) {
      await emit(repo, {
        event: "graph.node.retry",
        task: graph.task,
        agent: node.agent,
        data: { node: node.id, attempt: node.attempts, error: result.error },
      })
      await save(repo, graph)
      await attempt(node)
      return
    }

    node.status = "failed"
    await emit(repo, {
      event: "graph.node.failed",
      task: graph.task,
      agent: node.agent,
      data: { node: node.id, error: result.error },
    })
    await save(repo, graph)
    failed(node)
  }

  while (true) {
    if (opts.signal?.aborted) {
      // Pending nodes stay pending so a later run() resumes exactly here.
      await save(repo, graph)
      return graph
    }

    const runnable = ready(graph).filter((node) => !skipped.has(node.id))
    if (runnable.length === 0) {
      const running = graph.nodes.some((node) => node.status === "running")
      if (!running) {
        await emit(repo, { event: "graph.completed", task: graph.task, data: summary(graph) })
        await save(repo, graph)
        return graph
      }
      await Bun.sleep(10)
      continue
    }

    const batch = runnable.slice(0, concurrency)
    await Promise.all(batch.map((node) => attempt(node)))
  }
}

function dependsOn(graph: Graph, node: Node, id: string): boolean {
  if (node.dependencies.includes(id)) return true
  return node.dependencies.some((dep) => {
    const parent = graph.nodes.find((candidate) => candidate.id === dep)
    return parent ? dependsOn(graph, parent, id) : false
  })
}

/** Re-run a single node (and nothing else) inside a finished or failed graph. */
export function reset(graph: Graph, id: string, opts: { cascade?: boolean } = {}): Graph {
  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`no node ${JSON.stringify(id)} in graph`)
  node.status = "pending"
  node.attempts = 0
  node.error = undefined
  node.result = undefined
  if (!opts.cascade) return graph
  for (const dependent of graph.nodes.filter((candidate) => candidate.id !== id && dependsOn(graph, candidate, id))) {
    dependent.status = "pending"
    dependent.attempts = 0
    dependent.error = undefined
    dependent.result = undefined
  }
  return graph
}
