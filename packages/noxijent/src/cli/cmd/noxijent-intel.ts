import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Context, Contradiction, Graph, Manager, Memory, Understand } from "../../noxijent"

/**
 * Noxijent intelligence commands (roadmap Phase 2): repository understanding,
 * context selection, project memory, contradiction detection and the agent
 * manager / execution graph. Additive only — existing CLI behavior is
 * untouched.
 */

type RepoArgs = { repo: string }

function withRepo<T>(yargs: Argv<T>) {
  return yargs.option("repo", {
    type: "string",
    describe: "repository root",
    default: process.cwd(),
  })
}

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}

function line(text: string) {
  process.stdout.write(text + "\n")
}

function handle<T>(fn: (args: T) => Promise<void>) {
  return async (args: T) => {
    try {
      await fn(args)
    } catch (error) {
      process.stderr.write(`noxijent: error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}

function sourcesOption<T>(yargs: Argv<T>) {
  return yargs.option("source", {
    type: "string",
    array: true,
    describe: "evidence source path (repeatable)",
  })
}

function toSources(paths: string[] | undefined, note?: string) {
  return (paths ?? []).map((path) => ({ path, note }))
}

export const UnderstandCommand = cmd({
  command: "understand",
  describe: "analyze the repository (languages, architecture, tests, tech debt)",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .option("json", { type: "boolean", default: false, describe: "print the raw report as JSON" })
      .option("max-files", { type: "number", describe: "maximum files to scan", default: 25_000 }),
  handler: handle(async (args: RepoArgs & { json: boolean; maxFiles: number }) => {
    const report = await Understand.analyze(args.repo, { maxFiles: args.maxFiles })
    if (args.json) return print(report)
    line(Understand.render(report))
  }),
})

export const ContextCommand = cmd({
  command: "context <query>",
  describe: "select the files most relevant to a task or query",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .positional("query", { type: "string", demandOption: true, describe: "task or query text" })
      .option("task", { type: "string", describe: "task name (recorded with snapshots)" })
      .option("max-files", { type: "number", describe: "maximum selected files" })
      .option("max-bytes", { type: "number", describe: "byte budget for the selection" })
      .option("previous", { type: "string", array: true, describe: "file touched by previous failed attempts" })
      .option("snapshot", { type: "boolean", default: false, describe: "persist the selection for later review" })
      .option("json", { type: "boolean", default: false, describe: "print the raw selection as JSON" }),
  handler: handle(
    async (
      args: RepoArgs & {
        query: string
        task?: string
        maxFiles?: number
        maxBytes?: number
        previous?: string[]
        snapshot: boolean
        json: boolean
      },
    ) => {
      const opts = {
        repo: args.repo,
        query: args.query,
        task: args.task,
        previousFailures: args.previous,
        maxFiles: args.maxFiles,
        maxBytes: args.maxBytes,
      }
      if (args.snapshot) return print(await Context.snapshot(opts))
      const ranked = await Context.rank(opts)
      if (args.json) return print(ranked)
      for (const entry of ranked)
        line(`${String(entry.score).padStart(3)}  ${entry.file}  (${[...entry.reasons].join(", ")})`)
    },
  ),
})

export const PlanCommand = cmd({
  command: "plan <task>",
  describe: "decompose a task into the agent roles it actually needs, as an execution graph",
  builder: (yargs: Argv) =>
    withRepo(yargs).positional("task", { type: "string", demandOption: true, describe: "task description" }),
  handler: handle(async (args: RepoArgs & { task: string }) => {
    const plan = await Manager.decompose(args.task)
    const graph = Manager.graphOf(args.task, plan)
    print({
      task: args.task,
      assignments: plan.assignments,
      layers: Graph.layers(graph),
    })
  }),
})

export const MemoryCommand = cmd({
  command: "memory",
  describe: "persistent project memory with evidence and confidence scoring",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "list",
          describe: "list memory entries",
          builder: (builder: Argv) =>
            withRepo(builder)
              .option("status", { type: "string", choices: ["active", "disputed", "deprecated"] as const })
              .option("query", { type: "string", describe: "filter by key or fact text" }),
          handler: handle(
            async (args: RepoArgs & { status?: "active" | "disputed" | "deprecated"; query?: string }) => {
              print(await Memory.list(args.repo, { status: args.status, query: args.query }))
            },
          ),
        }),
      )
      .command(
        cmd({
          command: "add <key> <fact>",
          describe: "record a fact (repeat with extra --source evidence to boost confidence)",
          builder: (builder: Argv) =>
            sourcesOption(
              withRepo(builder)
                .positional("key", { type: "string", demandOption: true, describe: "memory key" })
                .positional("fact", { type: "string", demandOption: true, describe: "the fact to remember" })
                .option("confidence", { type: "number", describe: "explicit confidence in [0, 1]" }),
            ),
          handler: handle(
            async (args: RepoArgs & { key: string; fact: string; confidence?: number; source?: string[] }) => {
              const entry = await Memory.add(args.repo, {
                key: args.key,
                fact: args.fact,
                confidence: args.confidence,
                sources: toSources(args.source),
              })
              line(`memory ${entry.key}: confidence ${entry.confidence.toFixed(2)} [${entry.status}]`)
            },
          ),
        }),
      )
      .command(
        cmd({
          command: "confirm <key>",
          describe: "confirm a fact with new evidence (raises confidence)",
          builder: (builder: Argv) =>
            sourcesOption(withRepo(builder).positional("key", { type: "string", demandOption: true })),
          handler: handle(async (args: RepoArgs & { key: string; source?: string[] }) => {
            const entry = await Memory.confirm(args.repo, args.key, toSources(args.source))
            line(`memory ${entry.key}: confidence ${entry.confidence.toFixed(2)} [${entry.status}]`)
          }),
        }),
      )
      .command(
        cmd({
          command: "dispute <key> <evidence>",
          describe: "mark a fact as disputed with contradicting evidence (halves confidence)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("key", { type: "string", demandOption: true })
              .positional("evidence", { type: "string", demandOption: true, describe: "why the fact is disputed" }),
          handler: handle(async (args: RepoArgs & { key: string; evidence: string }) => {
            const entry = await Memory.dispute(args.repo, args.key, args.evidence)
            line(`memory ${entry.key}: confidence ${entry.confidence.toFixed(2)} [${entry.status}]`)
          }),
        }),
      )
      .command(
        cmd({
          command: "resolve <key> <fact>",
          describe: "re-activate a disputed fact with the corrected value",
          builder: (builder: Argv) =>
            sourcesOption(
              withRepo(builder)
                .positional("key", { type: "string", demandOption: true })
                .positional("fact", { type: "string", demandOption: true }),
            ),
          handler: handle(async (args: RepoArgs & { key: string; fact: string; source?: string[] }) => {
            const entry = await Memory.resolve(args.repo, args.key, args.fact, toSources(args.source))
            line(`memory ${entry.key}: confidence ${entry.confidence.toFixed(2)} [${entry.status}]`)
          }),
        }),
      )
      .command(
        cmd({
          command: "deprecate <key> [detail]",
          describe: "deprecate a fact (kept for audit, confidence zeroed)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("key", { type: "string", demandOption: true })
              .positional("detail", { type: "string", describe: "why the fact is deprecated" }),
          handler: handle(async (args: RepoArgs & { key: string; detail?: string }) => {
            const entry = await Memory.deprecate(args.repo, args.key, args.detail)
            line(`memory ${entry.key}: confidence ${entry.confidence.toFixed(2)} [${entry.status}]`)
          }),
        }),
      )
      .command(
        cmd({
          command: "remove <key>",
          describe: "permanently remove a memory entry",
          builder: (builder: Argv) => withRepo(builder).positional("key", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { key: string }) => {
            const removed = await Memory.remove(args.repo, args.key)
            line(removed ? `removed ${args.key}` : `no memory entry named ${args.key}`)
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const ContradictionsCommand = cmd({
  command: "contradictions",
  describe: "detect conflicts between instructions, docs, lockfiles, CI and code",
  builder: (yargs: Argv) => withRepo(yargs).option("json", { type: "boolean", default: false }),
  handler: handle(async (args: RepoArgs & { json: boolean }) => {
    const findings = await Contradiction.scan(args.repo)
    if (args.json) return print(findings)
    if (findings.length === 0) return line("no contradictions detected")
    const icons: Record<string, string> = { error: "✗", warning: "⚠", info: "ℹ" }
    const icon = (severity: string) => icons[severity] ?? "•"
    for (const finding of findings) {
      line(`${icon(finding.severity)} [${finding.severity}] ${finding.summary} (${finding.rule})`)
      for (const item of finding.evidence) line(`    ${item.source} — ${item.detail}`)
    }
    if (findings.some((finding) => finding.severity !== "info")) process.exitCode = 1
  }),
})
