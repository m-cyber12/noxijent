import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Hooks, Profiles, Routing, Tournament, Workflow } from "../../noxijent"

/**
 * Noxijent advanced-orchestration commands (roadmap Phase 4): agent
 * profiles, agent hooks, local model routing, model tournaments and workflow
 * files. (Dynamic teams ship as the Teams library used by the manager —
 * they execute against live agents, so there is no CLI for them.)
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

export const ProfileCommand = cmd({
  command: "profile",
  describe: "reusable agent definitions (.noxijent/profiles/)",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "list",
          describe: "list agent profiles",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            print(await Profiles.list(args.repo))
          }),
        }),
      )
      .command(
        cmd({
          command: "get <name>",
          describe: "show a profile resolved for execution",
          builder: (builder: Argv) => withRepo(builder).positional("name", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { name: string }) => {
            print(Profiles.resolve(await Profiles.get(args.repo, args.name)))
          }),
        }),
      )
      .command(
        cmd({
          command: "define <file>",
          describe: "create or update a profile from a JSON file",
          builder: (builder: Argv) =>
            withRepo(builder).positional("file", {
              type: "string",
              demandOption: true,
              describe: "JSON profile document",
            }),
          handler: handle(async (args: RepoArgs & { file: string }) => {
            const document = JSON.parse(await Bun.file(args.file).text()) as Parameters<typeof Profiles.define>[1]
            const profile = await Profiles.define(args.repo, document)
            line(`profile ${profile.name} saved`)
          }),
        }),
      )
      .command(
        cmd({
          command: "remove <name>",
          describe: "remove a profile",
          builder: (builder: Argv) => withRepo(builder).positional("name", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { name: string }) => {
            line(
              (await Profiles.remove(args.repo, args.name))
                ? `removed ${args.name}`
                : `no agent profile named ${args.name}`,
            )
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const HooksCommand = cmd({
  command: "hooks",
  describe: "lifecycle hook points (.noxijent/hooks.json)",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "list",
          describe: "show the registered hooks per point",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            const config = await Hooks.load(args.repo)
            for (const point of Hooks.POINTS) {
              const hooks = Hooks.registered(config, point)
              if (hooks.length === 0) continue
              line(`${point}:`)
              for (const hook of hooks) line(`  ${hook.command.join(" ")}  (${hook.onError}, ${hook.timeoutMs}ms)`)
            }
          }),
        }),
      )
      .command(
        cmd({
          command: "run <point>",
          describe: "execute the hooks for a lifecycle point",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("point", {
                type: "string",
                demandOption: true,
                choices: [...Hooks.POINTS] as unknown as string[],
              })
              .option("task", { type: "string", describe: "task context handed to hooks" })
              .option("json-context", { type: "string", describe: "extra context as a JSON object" }),
          handler: handle(async (args: RepoArgs & { point: string; task?: string; jsonContext?: string }) => {
            const extra = args.jsonContext ? (JSON.parse(args.jsonContext) as Record<string, unknown>) : {}
            const result = await Hooks.run(args.repo, args.point as (typeof Hooks.POINTS)[number], {
              task: args.task,
              ...extra,
            })
            print(result)
            if (!result.ok) process.exitCode = 1
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const RouteCommand = cmd({
  command: "route <task>",
  describe: "pick the right local model for a task or role",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .positional("task", { type: "string", demandOption: true, describe: "task text, or a manager role with --role" })
      .option("role", { type: "boolean", default: false, describe: "treat <task> as a manager role name" })
      .option("prefer", { type: "string", choices: ["cost", "latency", "quality"] as const })
      .option("max-cost-tier", { type: "number" })
      .option("min-tier", { type: "number" })
      .option("context-size", { type: "number", describe: "estimated tokens the model must fit" })
      .option("json", { type: "boolean", default: false }),
  handler: handle(
    async (
      args: RepoArgs & {
        task: string
        role: boolean
        prefer?: "cost" | "latency" | "quality"
        maxCostTier?: number
        minTier?: number
        contextSize?: number
        json: boolean
      },
    ) => {
      const constraints = {
        prefer: args.prefer,
        maxCostTier: args.maxCostTier,
        minTier: args.minTier,
        contextSize: args.contextSize,
      }
      const choice = args.role
        ? await Routing.routeRole(args.repo, args.task, constraints)
        : await Routing.route(args.repo, args.task, constraints)
      if (args.json) return print(choice)
      line(
        `${choice.model.name}  (tier ${choice.model.tier}, cost ${choice.model.costTier}, latency ${choice.model.latencyTier}, ctx ${choice.model.contextWindow})`,
      )
      for (const reason of choice.reasons) line(`  · ${reason}`)
      if (choice.alternatives[0]) line(`next best: ${choice.alternatives[0].name}`)
    },
  ),
})

export const TournamentCommand = cmd({
  command: "tournament",
  describe: "compare candidate implementations with objective signals",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "run <spec>",
          describe: "run a tournament from a JSON spec file",
          builder: (builder: Argv) => withRepo(builder).positional("spec", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { spec: string }) => {
            const spec = JSON.parse(await Bun.file(args.spec).text())
            const report = await Tournament.run(args.repo, spec)
            line(Tournament.render(report))
            if (!report.winner) process.exitCode = 1
          }),
        }),
      )
      .command(
        cmd({
          command: "latest",
          describe: "show the latest tournament report",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            const report = await Tournament.latest(args.repo)
            if (!report) return line("no tournaments recorded yet")
            line(Tournament.render(report))
          }),
        }),
      )
      .command(
        cmd({
          command: "list",
          describe: "list recorded tournament reports",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            print(await Tournament.list(args.repo))
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const WorkflowCommand = cmd({
  command: "workflow",
  describe: "reusable engineering workflows (.noxijent/workflows/)",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "list",
          describe: "list workflows",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            print(await Workflow.list(args.repo))
          }),
        }),
      )
      .command(
        cmd({
          command: "show <name>",
          describe: "show a workflow definition",
          builder: (builder: Argv) => withRepo(builder).positional("name", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { name: string }) => {
            print(await Workflow.load(args.repo, args.name))
          }),
        }),
      )
      .command(
        cmd({
          command: "run <name>",
          describe: "run a workflow and record the run",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("name", { type: "string", demandOption: true })
              .option("task", { type: "string" }),
          handler: handle(async (args: RepoArgs & { name: string; task?: string }) => {
            const record = await Workflow.run(args.repo, args.name, { task: args.task })
            line(Workflow.render(record))
            if (!record.ok) process.exitCode = 1
          }),
        }),
      )
      .command(
        cmd({
          command: "latest <name>",
          describe: "show the latest run record for a workflow",
          builder: (builder: Argv) => withRepo(builder).positional("name", { type: "string", demandOption: true }),
          handler: handle(async (args: RepoArgs & { name: string }) => {
            const record = await Workflow.latest(args.repo, args.name)
            if (!record) return line(`no recorded runs for workflow ${args.name}`)
            line(Workflow.render(record))
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})
