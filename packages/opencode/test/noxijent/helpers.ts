import { $ } from "bun"
import { expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "path"

/** Await a rejection deterministically and check the error message. */
export async function rejects(promise: Promise<unknown>, match: string) {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(error, "expected the promise to reject").not.toBeUndefined()
  expect(error instanceof Error ? error.message : String(error)).toContain(match)
}

const dirs: string[] = []

/** Create a temp directory outside any git repository, tracked for cleanup. */
export async function tempdir(prefix = "noxijent-test-") {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** Create a temp git repository with one commit, tracked for cleanup. */
export async function temprepo() {
  const repo = await tempdir()
  await $`git -C ${repo} init -q -b main`.quiet()
  await $`git -C ${repo} config user.email test@noxijent.dev`.quiet()
  await $`git -C ${repo} config user.name noxijent-test`.quiet()
  await $`git -C ${repo} config commit.gpgsign false`.quiet()
  await Bun.write(path.join(repo, "file.txt"), "hello\n")
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} commit -qm initial`.quiet()
  return repo
}

export async function cleanup() {
  const pending = dirs.splice(0)
  // Agent worktrees live inside the repo dir; prune them so rm -rf succeeds.
  for (const dir of pending) {
    const inside = await $`git -C ${dir} worktree list --porcelain`.quiet().nothrow()
    if (inside.exitCode === 0) {
      const managed = inside
        .text()
        .split("\n")
        .filter((line) => line.startsWith("worktree ") && line.includes("/.noxijent/state/worktrees/"))
        .map((line) => line.slice("worktree ".length))
      for (const worktree of managed) {
        await $`git -C ${dir} worktree remove --force ${worktree}`.quiet().nothrow()
      }
    }
    await rm(dir, { recursive: true, force: true })
  }
}
