// Workflow files (roadmap §26 / Phase 4 #22): reusable engineering flows at
// `.noxijent/workflows/<name>.json`. Steps form a DAG (validated by the
// execution-graph engine) whose nodes dispatch to built-in actions —
// understand/context, repro, verify, red-team, benchmark, hooks — or plain
// notes. Runs persist under `.noxijent/state/workflows/` with summary events.

import { readdir, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import * as Benchmark from "./benchmark"
import * as Context from "./context"
import { emit as emitEvent } from "./events"
import * as Graph from "./graph"
import * as Hooks from "./hooks"
import * as Paths from "./paths"
import * as Redteam from "./redteam"
import * as Repro from "./repro"
import * as Understand from "./understand"
import * as Verify from "./verify"

export const ACTIONS = ["note", "understand", "context", "repro", "verify", "redteam", "benchmark", "hook"] as const
export type Action = (typeof ACTIONS)[number]

export const Step = z.object({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  uses: z.enum(ACTIONS).default("note"),
  agent: z.string().optional(),
  params: z.record(z.string(), z.any()).default({}),
  dependsOn: z.array(z.string()).default([]),
})
export type Step = z.infer<typeof Step>

export const Workflow = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(Step).min(1),
})
export type Workflow = z.infer<typeof Workflow>

export type RunRecord = {
  workflow: string
  task: string
  at: string
  ok: boolean
  durationMs: number
  nodes: Array<{ id: string; agent: string; status: string; attempts: number; error?: string; output?: unknown }>
}

function dir(repo: string) {
  return path.join(repo, ".noxijent", "workflows")
}

function stateDir(repo: string) {
  return Paths.stateDir(repo, "workflows")
}

export async function list(repo: string): Promise<string[]> {
  const entries = await readdir(dir(repo)).catch(() => [] as string[])
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort()
}

export async function load(repo: string, name: string): Promise<Workflow> {
  const text = await readFile(path.join(dir(repo), `${name}.json`), "utf8").catch(() => {
    throw new Error(`no workflow named ${name} (.noxijent/workflows/${name}.json)`)
  })
  try {
    return Workflow.parse(JSON.parse(text))
  } catch (error) {
    throw new Error(`invalid workflow ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Compile a workflow to the execution graph (validates the DAG). */
export function compile(workflow: Workflow): Graph.Graph {
  return Graph.create(
    workflow.name,
    workflow.steps.map((step) => ({
      id: step.id,
      description: step.description ?? `${step.uses} step ${step.id}`,
      dependencies: step.dependsOn,
      agent: step.agent ?? step.uses,
      run: { uses: step.uses, params: step.params },
    })),
  )
}

async function dispatch(repo: string, node: Graph.Node, workflow: Workflow, task?: string): Promise<unknown> {
  const { uses, params } = node.run as { uses: Action; params: Record<string, unknown> }
  switch (uses) {
    case "note":
      return { noted: params.text ?? node.description }
    case "understand": {
      const report = await Understand.analyze(repo)
      return { languages: report.files.byLanguage, ci: report.manifests.ciSystems }
    }
    case "context": {
      const query = String(params.query ?? workflow.name)
      const ranked = await Context.rank({
        repo,
        query,
        maxFiles: typeof params.maxFiles === "number" ? params.maxFiles : 10,
      })
      return { selected: ranked.map((entry) => entry.file) }
    }
    case "repro": {
      const issue = String(params.issue ?? node.description)
      const planResult = await Repro.scaffold(repo, issue)
      return { scaffold: planResult.scaffoldPath, suspects: planResult.suspects.map((entry) => entry.file) }
    }
    case "verify": {
      const result = await Verify.run({
        repo,
        task,
        maxAttempts: typeof params.maxAttempts === "number" ? params.maxAttempts : 1,
      })
      if (!result.ok) throw new Error("verify loop failed")
      return { ok: true, attempts: result.attempts.length }
    }
    case "redteam": {
      const result = await Redteam.review(repo, { staged: params.staged === true, task })
      if (!result.ok) throw new Error(`red-team review found ${result.counts.error} error(s)`)
      return { findings: result.findings.length, counts: result.counts }
    }
    case "benchmark": {
      const filter = typeof params.name === "string" ? params.name : undefined
      const result = await Benchmark.run(repo, { filter })
      if (result.stats.failed > 0) throw new Error(`benchmark: ${result.stats.failed} scenario(s) failed`)
      return result.stats
    }
    case "hook": {
      const point = Hooks.POINTS.find((entry) => entry === params.point)
      if (!point) throw new Error(`unknown hook point ${JSON.stringify(params.point)}`)
      const result = await Hooks.run(repo, point, { task, workflow: workflow.name, step: node.id })
      if (!result.ok) throw new Error(`hook chain failed at ${point}`)
      return { hooks: result.results.length }
    }
  }
}

/** Run a workflow; persists a run record and emits summary events. */
export async function run(repo: string, name: string, opts: { task?: string } = {}): Promise<RunRecord> {
  const workflow = await load(repo, name)
  const task = opts.task ?? workflow.name
  const graph = compile(workflow)
  await emitEvent(repo, { event: "workflow.started", task, data: { workflow: name, steps: graph.nodes.length } })

  const startedAt = Date.now()
  const final = await Graph.run(repo, graph, (node) => dispatch(repo, node, workflow, task), { concurrency: 1 })

  const nodes = final.nodes.map((node) => ({
    id: node.id,
    agent: node.agent,
    status: node.status,
    attempts: node.attempts,
    error: node.error,
    output: node.result,
  }))
  const failed = nodes.filter((node) => node.status === "failed" || node.status === "skipped")
  const record: RunRecord = {
    workflow: name,
    task,
    at: new Date(startedAt).toISOString(),
    ok: failed.length === 0,
    durationMs: Date.now() - startedAt,
    nodes,
  }

  await Paths.ensureState(repo, "workflows")
  const stamp = `${Paths.slug(name)}-${startedAt}`
  const target = path.join(stateDir(repo), `${stamp}.json`)
  await Bun.write(target, JSON.stringify(record, null, 2) + "\n")
  await Bun.write(path.join(stateDir(repo), `${Paths.slug(name)}-latest.json`), JSON.stringify(record, null, 2) + "\n")

  await emitEvent(repo, {
    event: record.ok ? "workflow.completed" : "workflow.failed",
    task,
    data: { workflow: name, ok: record.ok, durationMs: record.durationMs },
  })
  return record
}

/** Latest run record for a workflow (if any). */
export async function latest(repo: string, name: string): Promise<RunRecord | undefined> {
  const text = await readFile(path.join(stateDir(repo), `${Paths.slug(name)}-latest.json`), "utf8").catch(
    () => undefined,
  )
  if (!text) return undefined
  try {
    return JSON.parse(text) as RunRecord
  } catch {
    return undefined
  }
}

export function render(record: RunRecord): string {
  const lines = [
    `workflow ${record.workflow} — task ${record.task}`,
    `at ${record.at} · ${record.durationMs}ms · ${record.ok ? "ok" : "FAILED"}`,
    ``,
  ]
  for (const node of record.nodes) {
    const status = node.status === "done" ? "✓" : node.status === "failed" ? "✗" : "-"
    lines.push(`  ${status} ${node.id}  [${node.agent}]${node.error ? ` — ${node.error}` : ""}`)
  }
  return lines.join("\n")
}
