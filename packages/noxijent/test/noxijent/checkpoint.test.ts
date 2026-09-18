import { afterEach, describe, expect, it } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Checkpoint } from "../../src/noxijent"
import { cleanup, rejects, temprepo } from "./helpers"

afterEach(cleanup)

describe("checkpoint", () => {
  it("creates numbered checkpoints without touching the working tree or index", async () => {
    const repo = await temprepo()
    await Bun.write(path.join(repo, "file.txt"), "changed\n")

    const first = await Checkpoint.create({ repo, task: "auth" })
    expect(first.seq).toBe(1)
    expect(first.ref).toBe("refs/noxijent/checkpoints/auth/1")

    const second = await Checkpoint.create({ repo, task: "auth" })
    expect(second.seq).toBe(2)

    // Working tree is untouched: change still present, nothing staged.
    expect(await Bun.file(path.join(repo, "file.txt")).text()).toBe("changed\n")
    const status = await $`git -C ${repo} status --porcelain`.text()
    expect(status.trim()).toBe("M file.txt")

    // The checkpoint commit contains the snapshot content.
    const content = await $`git -C ${repo} show ${first.commit}:file.txt`.text()
    expect(content).toBe("changed\n")
  })

  it("snapshots untracked files but respects .gitignore", async () => {
    const repo = await temprepo()
    await Bun.write(path.join(repo, ".gitignore"), "secret.log\n")
    await Bun.write(path.join(repo, "new.ts"), "export {}\n")
    await Bun.write(path.join(repo, "secret.log"), "shh\n")

    const created = await Checkpoint.create({ repo, task: "untracked" })

    const files = await $`git -C ${repo} ls-tree -r --name-only ${created.commit}`.text()
    expect(files).toContain("new.ts")
    expect(files).not.toContain("secret.log")
  })

  it("lists checkpoints per task and across tasks", async () => {
    const repo = await temprepo()
    await Checkpoint.create({ repo, task: "a" })
    await Checkpoint.create({ repo, task: "a" })
    await Checkpoint.create({ repo, task: "b" })

    expect((await Checkpoint.list({ repo })).length).toBe(3)
    expect((await Checkpoint.list({ repo, task: "a" })).length).toBe(2)

    const items = await Checkpoint.list({ repo, task: "a" })
    expect(items.map((item) => item.seq)).toEqual([1, 2])
  })

  it("diffs a checkpoint against the working tree", async () => {
    const repo = await temprepo()
    const created = await Checkpoint.create({ repo, task: "diff" })
    await Bun.write(path.join(repo, "file.txt"), "after checkpoint\n")

    const diff = await Checkpoint.diff({ repo, task: "diff", seq: created.seq })
    expect(diff).toContain("+after checkpoint")

    const none = await Checkpoint.diff({ repo, task: "diff", seq: created.seq, to: created.commit })
    expect(none.trim()).toBe("")
  })

  it("restores the worktree to a checkpoint", async () => {
    const repo = await temprepo()
    await Checkpoint.create({ repo, task: "restore" })
    await Bun.write(path.join(repo, "file.txt"), "broken\n")

    await Checkpoint.restore({ repo, task: "restore", seq: 1 })
    expect(await Bun.file(path.join(repo, "file.txt")).text()).toBe("hello\n")
  })

  it("restores deletions and removes extra files with deleteExtra", async () => {
    const repo = await temprepo()
    await Checkpoint.create({ repo, task: "extra" })

    await $`git -C ${repo} rm -q file.txt`.quiet()
    await Bun.write(path.join(repo, "unwanted.txt"), "x\n")

    await Checkpoint.restore({ repo, task: "extra", seq: 1, deleteExtra: true })
    expect(await Bun.file(path.join(repo, "file.txt")).text()).toBe("hello\n")
    expect(await Bun.file(path.join(repo, "unwanted.txt")).exists()).toBe(false)
  })

  it("re-runs from a checkpoint by creating a later one", async () => {
    const repo = await temprepo()
    await Checkpoint.create({ repo, task: "replay" })
    await Bun.write(path.join(repo, "file.txt"), "bad path\n")
    await Checkpoint.create({ repo, task: "replay" })

    await Checkpoint.restore({ repo, task: "replay", seq: 1 })
    const rerun = await Checkpoint.create({ repo, task: "replay", message: "second attempt" })
    expect(rerun.seq).toBe(3)
    expect(await Bun.file(path.join(repo, "file.txt")).text()).toBe("hello\n")
  })

  it("drops checkpoints for one task or all tasks", async () => {
    const repo = await temprepo()
    await Checkpoint.create({ repo, task: "one" })
    await Checkpoint.create({ repo, task: "two" })

    expect(await Checkpoint.drop({ repo, task: "one" })).toBe(1)
    expect((await Checkpoint.list({ repo })).length).toBe(1)

    expect(await Checkpoint.drop({ repo })).toBe(1)
    expect(await Checkpoint.list({ repo })).toEqual([])
  })

  it("throws when restoring an unknown checkpoint", async () => {
    const repo = await temprepo()
    await rejects(Checkpoint.restore({ repo, task: "missing", seq: 42 }), "no checkpoint 42")
  })
})
