import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Checkpoint, Done, Events, Risk, Verify, Worktree } from "../../noxijent"

/**
 * Noxijent foundation commands (roadmap Phase 1): agent worktrees,
 * checkpoints, structured events, definition of done, the verify loop and
 * risk-based action policies. All commands are additive — they never alter
 * existing CLI behavior.
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

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage isolated git worktrees per agent",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "create <agent>",
          describe: "create a worktree and branch for an agent",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("agent", { type: "string", demandOption: true, describe: "agent name" })
              .option("base", { type: "string", describe: "base ref to branch from" }),
          handler: handle(async (args: { agent: string; repo: string; base?: string }) => {
            const info = await Worktree.create({ repo: args.repo, agent: args.agent, baseRef: args.base })
            print(info)
          }),
        }),
      )
      .command(
        cmd({
          command: "list",
          describe: "list agent worktrees",
          builder: (builder: Argv) => withRepo(builder),
          handler: handle(async (args: RepoArgs) => {
            print(await Worktree.listManaged({ repo: args.repo }))
          }),
        }),
      )
      .command(
        cmd({
          command: "status <agent>",
          describe: "show uncommitted changes in an agent worktree",
          builder: (builder: Argv) =>
            withRepo(builder).positional("agent", { type: "string", demandOption: true, describe: "agent name" }),
          handler: handle(async (args: { agent: string; repo: string }) => {
            print(await Worktree.status({ repo: args.repo, agent: args.agent }))
          }),
        }),
      )
      .command(
        cmd({
          command: "remove <agent>",
          describe: "remove an agent worktree (and its branch unless kept)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("agent", { type: "string", demandOption: true, describe: "agent name" })
              .option("force", { type: "boolean", default: false, describe: "remove even with uncommitted changes" })
              .option("keep-branch", { type: "boolean", default: false, describe: "keep the agent branch" }),
          handler: handle(async (args: { agent: string; repo: string; force: boolean; keepBranch: boolean }) => {
            await Worktree.remove({
              repo: args.repo,
              agent: args.agent,
              force: args.force,
              keepBranch: args.keepBranch,
            })
            line(`removed worktree for agent ${args.agent}`)
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const CheckpointCommand = cmd({
  command: "checkpoint",
  describe: "time-machine checkpoints for tasks",
  builder: (yargs: Argv) =>
    yargs
      .command(
        cmd({
          command: "create <task>",
          describe: "snapshot the working tree without touching the index",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true, describe: "task name" })
              .option("message", { type: "string", describe: "checkpoint message" }),
          handler: handle(async (args: { task: string; repo: string; message?: string }) => {
            const info = await Checkpoint.create({ repo: args.repo, task: args.task, message: args.message })
            line(`checkpoint ${info.task}#${info.seq} (${info.commit.slice(0, 8)})`)
          }),
        }),
      )
      .command(
        cmd({
          command: "list [task]",
          describe: "list checkpoints (optionally for one task)",
          builder: (builder: Argv) => withRepo(builder).positional("task", { type: "string", describe: "task name" }),
          handler: handle(async (args: { repo: string; task?: string }) => {
            print(await Checkpoint.list({ repo: args.repo, task: args.task }))
          }),
        }),
      )
      .command(
        cmd({
          command: "diff <task> <seq>",
          describe: "diff a checkpoint against the working tree (or another ref with --to)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true, describe: "task name" })
              .positional("seq", { type: "number", demandOption: true, describe: "checkpoint number" })
              .option("to", { type: "string", describe: "ref to diff against instead of the working tree" }),
          handler: handle(async (args: { task: string; seq: number; repo: string; to?: string }) => {
            line(await Checkpoint.diff({ repo: args.repo, task: args.task, seq: args.seq, to: args.to }))
          }),
        }),
      )
      .command(
        cmd({
          command: "restore <task> <seq>",
          describe: "restore the working tree to a checkpoint (worktree only)",
          builder: (builder: Argv) =>
            withRepo(builder)
              .positional("task", { type: "string", demandOption: true, describe: "task name" })
              .positional("seq", { type: "number", demandOption: true, describe: "checkpoint number" })
              .option("delete-extra", {
                type: "boolean",
                default: false,
                describe: "also delete files that did not exist at the checkpoint",
              }),
          handler: handle(async (args: { task: string; seq: number; repo: string; deleteExtra: boolean }) => {
            const target = await Checkpoint.restore({
              repo: args.repo,
              task: args.task,
              seq: args.seq,
              deleteExtra: args.deleteExtra,
            })
            line(`restored ${target.task}#${target.seq} (${target.commit.slice(0, 8)})`)
          }),
        }),
      )
      .command(
        cmd({
          command: "drop [task]",
          describe: "drop checkpoints for a task (or all checkpoints)",
          builder: (builder: Argv) => withRepo(builder).positional("task", { type: "string", describe: "task name" }),
          handler: handle(async (args: { repo: string; task?: string }) => {
            const dropped = await Checkpoint.drop({ repo: args.repo, task: args.task })
            line(`dropped ${dropped} checkpoint(s)`)
          }),
        }),
      )
      .demandCommand(),
  handler: async () => {},
})

export const EventsCommand = cmd({
  command: "events",
  describe: "read the structured agent event log",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .option("task", { type: "string", describe: "filter by task" })
      .option("agent", { type: "string", describe: "filter by agent" })
      .option("n", { type: "number", describe: "show only the last N events", default: 50 }),
  handler: handle(async (args: RepoArgs & { task?: string; agent?: string; n: number }) => {
    print(await Events.read(args.repo, { task: args.task, agent: args.agent, tail: args.n }))
  }),
})

export const DoneCommand = cmd({
  command: "done",
  describe: "evaluate the repository definition of done (.noxijent/done.jsonc)",
  builder: (yargs: Argv) => withRepo(yargs),
  handler: handle(async (args: RepoArgs) => {
    const config = await Done.load(args.repo)
    if (!config) throw new Error(`no definition of done found (expected .noxijent/done.jsonc)`)
    const verdict = await Done.evaluate(args.repo, config)
    print(verdict)
    if (!verdict.ok) process.exitCode = 1
  }),
})

export const VerifyCommand = cmd({
  command: "verify [task]",
  describe: "run the test/fix/verify loop against the definition of done",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .positional("task", { type: "string", describe: "task name used for event attribution" })
      .option("max-attempts", { type: "number", describe: "maximum verify attempts", default: 1 }),
  handler: handle(async (args: RepoArgs & { task?: string; maxAttempts: number }) => {
    const result = await Verify.run({ repo: args.repo, task: args.task, maxAttempts: args.maxAttempts })
    print(result)
    if (!result.ok) process.exitCode = 1
  }),
})

export const RiskCommand = cmd({
  command: "risk <tool> [input]",
  describe: "classify the risk of a tool action and show the policy decision",
  builder: (yargs: Argv) =>
    withRepo(yargs)
      .positional("tool", { type: "string", demandOption: true, describe: "tool name (e.g. read, bash, edit)" })
      .positional("input", { type: "string", describe: "tool input (e.g. the shell command or file path)" }),
  handler: handle(async (args: RepoArgs & { tool: string; input?: string }) => {
    const config = await Risk.load(args.repo)
    print(Risk.decide(args.tool, args.input, config))
  }),
})
