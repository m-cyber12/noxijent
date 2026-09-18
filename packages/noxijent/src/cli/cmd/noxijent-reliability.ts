import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Archaeology, Benchmark, Flight, Redteam, Replay, Repro } from "../../noxijent"

/**
 * Noxijent reliability commands (roadmap Phase 3): agent flight recorder,
 * task replay, code archaeology, red-team review, issue reproduction and
 * benchmark mode. Additive only — existing CLI behavior is untouched.
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

export const FlightCommand = cmd({
  command: "flight",
  describe: "agent flight recorder — structured task execution timelines",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "start <task>",
          describe: "begin the timeline for a task",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true })
              .option("agent", { type: "string" }),
          handler: handle(async (args: RepoArgs & { task: string; agent?: string }) => {
            await Flight.start(args.repo, { task: args.task, agent: args.agent })
            line(`flight timeline started for ${args.task}`)
          }),
        }),
      )
      .command(
        cmd({
          command: "mark <task> <label>",
          describe: "append a mark to the task timeline",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true })
              .positional("label", { type: "string", demandOption: true })
              .option("agent", { type: "string" }),
          handler: handle(async (args: RepoArgs & { task: string; label: string; agent?: string }) => {
            await Flight.mark(args.repo, { task: args.task, label: args.label, agent: args.agent })
          }),
        }),
      )
      .command(
        cmd({
          command: "show <task>",
          describe: "render the task timeline",
          builder: (builder: Argv) => withRepo(builder).positional("task", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { task: string }) => {
            line(Flight.render(args.task, await Flight.timeline(args.repo, args.task)))
          }),
        }),
      )
      .command(
        cmd({
          command: "summary <task>",
          describe: "aggregate the task timeline (agents, marks, duration)",
          builder: (builder: Argv) => withRepo(builder).positional("task", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { task: string }) => {
            print(await Flight.summarize(args.repo, args.task))
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const ReplayCommand = cmd({
  command: "replay",
  describe: "record reproducible task executions for replay and comparison",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "record <task>",
          describe: "start a replay record",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true })
              .option("model", { type: "string", describe: "model used for this run" })
              .option("notes", { type: "string" }),
          handler: handle(async (args: RepoArgs & { task: string; model?: string; notes?: string }) => {
            const replay = await Replay.record(args.repo, { task: args.task, model: args.model, notes: args.notes })
            line(replay.id)
          }),
        }),
      )
      .command(
        cmd({
          command: "attach <id> <kind> <summary>",
          describe: "append a decision/tool/test/note step (never chain-of-thought)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("id", { type: "string", demandOption: true })
              .positional("kind", {
                type: "string",
                demandOption: true,
                choices: ["decision", "tool", "test", "note"] as const,
              })
              .positional("summary", { type: "string", demandOption: true }),
          handler: handle(
            async (args: RepoArgs & { id: string; kind: "decision" | "tool" | "test" | "note"; summary: string }) => {
              await Replay.attach(args.repo, args.id, { kind: args.kind, summary: args.summary })
            },
          ),
        }),
      )
      .command(
        cmd({
          command: "complete <id> <outcome>",
          describe: "seal a record as done/failed/aborted",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("id", { type: "string", demandOption: true })
              .positional("outcome", {
                type: "string",
                demandOption: true,
                choices: ["done", "failed", "aborted"] as const,
              })
              .option("summary", { type: "string" }),
          handler: handle(
            async (args: RepoArgs & { id: string; outcome: "done" | "failed" | "aborted"; summary?: string }) => {
              await Replay.complete(args.repo, args.id, { outcome: args.outcome, summary: args.summary })
            },
          ),
        }),
      )
      .command(
        cmd({
          command: "list [task]",
          describe: "list replay records (optionally for one task)",
          builder: (builder: Argv) => withRepo(builder).positional("task", { type: "string" }),
          handler: handle(async (args: RepoArgs & { task?: string }) => {
            print(await Replay.list(args.repo, { task: args.task }))
          }),
        }),
      )
      .command(
        cmd({
          command: "show <id>",
          describe: "render a replay record",
          builder: (builder: Argv) => withRepo(builder).positional("id", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { id: string }) => {
            line(Replay.render(await Replay.get(args.repo, args.id)))
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const ArchaeologyCommand = cmd({
  command: "archaeology <file>",
  describe: "explain why code exists using git history (blame, commits, tests)",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .positional("file", { type: "string", demandOption: true, describe: "repo-relative file path" })
      .option("from", { type: "number", describe: "first line of the range" })
      .option("to", { type: "number", describe: "last line of the range" })
      .option("max-commits", { type: "number", describe: "history depth", default: 10 })
      .option("json", { type: "boolean", default: false }),
  handler: handle(
    async (args: RepoArgs & { file: string; from?: number; to?: number; maxCommits: number; json: boolean }) => {
      const report = await Archaeology.explain(args.repo, {
        file: args.file,
        from: args.from,
        to: args.to,
        maxCommits: args.maxCommits,
      })
      if (args.json) return print(report)
      line(Archaeology.render(report))
    },
  ),
})

export const RedteamCommand = cmd({
  command: "redteam",
  describe: "adversarial review of the current changeset",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .option("staged", {
        type: "boolean",
        default: false,
        describe: "review the staged diff instead of HEAD…worktree",
      })
      .option("base", { type: "string", describe: "review the diff against this ref" })
      .option("task", { type: "string", describe: "task name for event attribution" })
      .option("json", { type: "boolean", default: false }),
  handler: handle(async (args: RepoArgs & { staged: boolean; base?: string; task?: string; json: boolean }) => {
    const result = await Redteam.review(args.repo, { staged: args.staged, base: args.base, task: args.task })
    if (args.json) return print(result)
    const icons: Record<string, string> = { error: "✗", warning: "⚠", info: "ℹ" }
    if (result.findings.length === 0) line("red-team review: clean")
    for (const finding of result.findings) {
      const place = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file
      line(`${icons[finding.severity] ?? "•"} [${finding.severity}] ${place} — ${finding.detail} (${finding.rule})`)
    }
    line(`files: ${result.files}, added lines: ${result.addedLines}, findings: ${result.findings.length}`)
    if (!result.ok) process.exitCode = 1
  }),
})

export const ReproCommand = cmd({
  command: "repro",
  describe: "turn an issue report into a reproduction scaffold",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "plan <issue>",
          describe: "rank suspect files for an issue report",
          builder: (builder: Argv) => withRepo(builder).positional("issue", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { issue: string }) => {
            print(await Repro.plan(args.repo, args.issue))
          }),
        }),
      )
      .command(
        cmd({
          command: "scaffold <issue>",
          describe: "write a failing-test scaffold under .noxijent/state/repro/",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("issue", { type: "string", demandOption: true })
              .option("target", { type: "string", describe: "explicit file under test" }),
          handler: handle(async (args: RepoArgs & { issue: string; target?: string }) => {
            const plan = await Repro.scaffold(args.repo, args.issue, { target: args.target })
            line(`scaffold written: ${plan.scaffoldPath}`)
            if (plan.suspects[0]) line(`prime suspect: ${plan.suspects[0].file} (score ${plan.suspects[0].score})`)
          }),
        }),
      )
      .command(
        cmd({
          command: "list",
          describe: "list reproduction scaffolds",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            print(await Repro.list(args.repo))
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const BenchmarkCommand = cmd({
  command: "benchmark",
  describe: "run repository-defined engineering scenarios (.noxijent/evals/)",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "run [name]",
          describe: "run all scenarios (or one)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("name", { type: "string" })
              .option("json", { type: "boolean", default: false }),
          handler: handle(async (args: RepoArgs & { name?: string; json: boolean }) => {
            const result = await Benchmark.run(args.repo, { filter: args.name })
            if (args.json) return print(result)
            line(Benchmark.render(result))
            if (result.stats.failed > 0) process.exitCode = 1
          }),
        }),
      )
      .command(
        cmd({
          command: "history",
          describe: "list recorded benchmark runs",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            for (const run of await Benchmark.history(args.repo)) {
              line(
                `${run.at}  tasks=${run.stats.tasks} passed=${run.stats.passed} failed=${run.stats.failed} avg=${run.stats.avgDurationMs}ms`,
              )
            }
          }),
        }),
      )
      .command(
        cmd({
          command: "compare",
          describe: "compare the latest run against the previous one",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            const result = await Benchmark.compare(args.repo)
            if (!result.comparable) return line(`need at least 2 runs to compare (have ${result.runs})`)
            line(`previous: ${result.previous}`)
            line(`latest:   ${result.latest}`)
            line(`regressions: ${result.regressions.join(", ") || "none"}`)
            line(`fixes:       ${result.fixes.join(", ") || "none"}`)
            line(`added:       ${result.added.join(", ") || "none"}`)
            line(`removed:     ${result.removed.join(", ") || "none"}`)
            for (const slow of result.slower) line(`slower:      ${slow.name} (+${slow.deltaMs}ms)`)
            if (result.regressions.length > 0) process.exitCode = 1
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})
