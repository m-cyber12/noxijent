import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "path"
import { slug } from "./paths"

/**
 * Checkpoints / time machine (roadmap §4).
 *
 * A checkpoint is a full snapshot of the working tree (staged, unstaged and
 * untracked-but-not-ignored files) stored as a commit under
 * `refs/noxijent/checkpoints/<task>/<seq>`.
 *
 * Snapshot creation NEVER touches the user's index or working tree: a
 * temporary GIT_INDEX_FILE is populated with `read-tree HEAD`, updated with
 * `add -A`, and committed with plumbing commands only. Restoring is explicit
 * and goes through `git restore --source=<ref> -- .` (worktree only, the
 * index is left alone) so the user can review before staging.
 *
 * All git access uses argv-based spawning (no shell) so file names with
 * spaces or shell metacharacters cannot corrupt command lines.
 */

export type Info = {
  task: string
  seq: number
  ref: string
  commit: string
  message: string
  createdAt: number
}

const REF_PREFIX = "refs/noxijent/checkpoints"

type GitOptions = { env?: Record<string, string>; input?: string }

async function git(repo: string, args: string[], opts: GitOptions = {}) {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdin: opts.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (opts.input !== undefined) {
    const stdin = proc.stdin
    if (stdin === undefined) throw new Error("git: failed to open stdin for the child process")
    await stdin.write(opts.input)
    await stdin.end()
  }
  // Read stdout/stderr concurrently with process exit so a full pipe buffer
  // can never deadlock the child process.
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`)
  }
  return stdout
}

export function refFor(task: string, seq: number) {
  return `${REF_PREFIX}/${slug(task)}/${seq}`
}

async function existingRefs(repo: string, task?: string): Promise<Info[]> {
  const pattern = task ? `${REF_PREFIX}/${slug(task)}` : REF_PREFIX
  const format = "%(refname) %(objectname) %(committerdate:unix) %(subject)"
  const raw = await git(repo, ["for-each-ref", "--sort=refname", `--format=${format}`, pattern])
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const space1 = line.indexOf(" ")
      const space2 = line.indexOf(" ", space1 + 1)
      const space3 = line.indexOf(" ", space2 + 1)
      const refname = line.slice(0, space1)
      const rest = refname.slice(REF_PREFIX.length + 1).split("/")
      return {
        ref: refname,
        commit: line.slice(space1 + 1, space2),
        createdAt: Number.parseInt(line.slice(space2 + 1, space3), 10),
        message: line.slice(space3 + 1),
        task: rest.slice(0, -1).join("/"),
        seq: Number.parseInt(rest[rest.length - 1] ?? "0", 10),
      }
    })
}

async function nextSeq(repo: string, task: string) {
  const refs = await existingRefs(repo, task)
  return refs.reduce((max, item) => Math.max(max, item.seq), 0) + 1
}

export async function create(opts: { repo: string; task: string; message?: string }): Promise<Info> {
  try {
    await git(opts.repo, ["rev-parse", "--verify", "HEAD"])
  } catch {
    throw new Error(`cannot create checkpoint: ${opts.repo} is not a git repository with at least one commit`)
  }

  const seq = await nextSeq(opts.repo, opts.task)
  const ref = refFor(opts.task, seq)
  const message = opts.message ?? `noxijent checkpoint ${slug(opts.task)}#${seq}`
  const index = path.join(tmpdir(), `noxijent-index-${process.pid}-${Date.now()}-${seq}`)
  const env = { GIT_INDEX_FILE: index }

  try {
    await git(opts.repo, ["read-tree", "HEAD"], { env })
    await git(opts.repo, ["add", "-A"], { env })
    const tree = (await git(opts.repo, ["write-tree"], { env })).trim()
    const commit = (await git(opts.repo, ["commit-tree", tree, "-p", "HEAD"], { input: message })).trim()
    await git(opts.repo, ["update-ref", ref, commit])
    return {
      task: slug(opts.task),
      seq,
      ref,
      commit,
      message,
      createdAt: Math.floor(Date.now() / 1000),
    }
  } finally {
    await rm(index, { force: true })
  }
}

export async function list(opts: { repo: string; task?: string }): Promise<Info[]> {
  return existingRefs(opts.repo, opts.task)
}

/** Unified diff between a checkpoint and another ref (default: the current working tree). */
export async function diff(opts: { repo: string; task: string; seq: number; to?: string }): Promise<string> {
  const ref = refFor(opts.task, opts.seq)
  if (opts.to) return git(opts.repo, ["diff", ref, opts.to])
  return git(opts.repo, ["diff", ref])
}

/**
 * Restore the working tree to a checkpoint. Files are overwritten in the
 * worktree only; the index is not modified. With `deleteExtra`, files that
 * did not exist at the checkpoint are removed as well (never ignored files),
 * making the worktree match the snapshot exactly.
 */
export async function restore(opts: { repo: string; task: string; seq: number; deleteExtra?: boolean }) {
  const checkpoints = await existingRefs(opts.repo, opts.task)
  const target = checkpoints.find((item) => item.seq === opts.seq)
  if (!target) throw new Error(`no checkpoint ${opts.seq} for task ${slug(opts.task)}`)

  await git(opts.repo, ["restore", `--source=${target.ref}`, "--", "."])

  if (opts.deleteExtra) {
    const atCheckpoint = new Set(
      (await git(opts.repo, ["ls-tree", "-r", "--name-only", target.ref])).split("\n").filter(Boolean),
    )
    const present = (await git(opts.repo, ["ls-files", "-c", "-o", "--exclude-standard"])).split("\n").filter(Boolean)
    const extra = present.filter((file) => !atCheckpoint.has(file)).map((file) => path.join(opts.repo, file))
    if (extra.length > 0) {
      const proc = Bun.spawn(["rm", "-f", "--", ...extra], { stdout: "ignore", stderr: "pipe" })
      await proc.exited
    }
  }
  return target
}

/** Drop all checkpoints for a task (or every checkpoint when task is omitted). */
export async function drop(opts: { repo: string; task?: string }) {
  const refs = await existingRefs(opts.repo, opts.task)
  for (const item of refs) {
    await git(opts.repo, ["update-ref", "-d", item.ref])
  }
  return refs.length
}
