import { $ } from "bun"
import path from "path"
import { ensureState, slug, stateDir } from "./paths"

/**
 * Git worktree per agent (roadmap §3).
 *
 * Independent agents get isolated git worktrees so that parallel agents never
 * modify the same working directory. Each agent receives its own branch
 * (`noxijent/agent/<slug>`) and directory (`.noxijent/state/worktrees/<slug>`).
 * Worktrees are created with plain git plumbing and require the repository to
 * have at least one commit.
 */

export type Info = {
  agent: string
  branch: string
  directory: string
  head: string
}

export const BRANCH_PREFIX = "noxijent/agent/"

async function ensureRepo(repo: string) {
  const result = await $`git -C ${repo} rev-parse --verify HEAD`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`cannot manage agent worktrees: ${repo} is not a git repository with at least one commit`)
  }
  return result.text().trim()
}

function toInfo(repo: string, agent: string, head: string): Info {
  const name = slug(agent)
  return {
    agent: name,
    branch: BRANCH_PREFIX + name,
    directory: stateDir(repo, "worktrees", name),
    head,
  }
}

export async function create(opts: { repo: string; agent: string; baseRef?: string }): Promise<Info> {
  const head = await ensureRepo(opts.repo)
  const info = toInfo(opts.repo, opts.agent, head)
  const base = opts.baseRef ?? "HEAD"
  await ensureState(opts.repo, "worktrees")

  const existing = await $`git -C ${opts.repo} worktree list --porcelain`.text()
  if (existing.split("\n").includes(`worktree ${info.directory}`)) {
    throw new Error(`worktree for agent ${info.agent} already exists at ${info.directory}`)
  }

  await $`git -C ${opts.repo} worktree add -b ${info.branch} ${info.directory} ${base}`.quiet()
  return info
}

/** All worktrees of the repository, annotated with whether Noxijent manages them. */
export async function list(opts: { repo: string }): Promise<Array<Info & { managed: boolean }>> {
  await ensureRepo(opts.repo)
  const prefix = stateDir(opts.repo, "worktrees")
  const raw = await $`git -C ${opts.repo} worktree list --porcelain`.text()
  return raw
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((line) => line.startsWith("worktree ")))
    .map((lines) => {
      const directory = lines.find((line) => line.startsWith("worktree "))!.slice("worktree ".length)
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length) ?? ""
      const branchLine = lines.find((line) => line.startsWith("branch "))
      const branch = branchLine ? branchLine.slice("branch ".length) : "detached"
      const short = branch.replace(/^refs\/heads\//, "")
      const agent = short.startsWith(BRANCH_PREFIX) ? short.slice(BRANCH_PREFIX.length) : path.basename(directory)
      return {
        agent,
        branch: short,
        directory,
        head,
        managed: directory.startsWith(prefix + path.sep) || directory.startsWith(prefix + "/"),
      }
    })
}

export async function listManaged(opts: { repo: string }): Promise<Info[]> {
  const all = await list(opts)
  return all.filter((item) => item.managed)
}

export type Status = {
  info: Info
  changes: string[]
  ahead: number
}

export async function status(opts: { repo: string; agent: string }): Promise<Status> {
  const info = toInfo(opts.repo, opts.agent, "")
  const worktrees = await list(opts)
  const found = worktrees.find((item) => item.directory === info.directory)
  if (!found) throw new Error(`no worktree found for agent ${info.agent}`)

  const porcelain = await $`git -C ${found.directory} status --porcelain`.text()
  const changes = porcelain.split("\n").filter((line) => line.length > 0)

  // "ahead" is only meaningful when the agent branch tracks an upstream;
  // without one we report 0 rather than failing.
  const upstream = await $`git -C ${found.directory} rev-list --count HEAD ^HEAD@{upstream}`.quiet().nothrow()
  const count = upstream.exitCode === 0 ? Number.parseInt(upstream.text().trim(), 10) : 0

  return { info: found, changes, ahead: Number.isNaN(count) ? 0 : count }
}

export async function remove(opts: { repo: string; agent: string; force?: boolean; keepBranch?: boolean }) {
  const info = toInfo(opts.repo, opts.agent, "")
  const worktrees = await list(opts)
  const found = worktrees.find((item) => item.directory === info.directory)
  if (!found) throw new Error(`no worktree found for agent ${info.agent}`)

  if (opts.force) await $`git -C ${opts.repo} worktree remove --force ${found.directory}`.quiet()
  else await $`git -C ${opts.repo} worktree remove ${found.directory}`.quiet()

  if (opts.keepBranch) return
  if (found.branch === "detached") return
  await $`git -C ${opts.repo} branch -D ${found.branch}`.quiet().nothrow()
}
