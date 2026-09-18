import { afterEach, describe, expect, it } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Worktree } from "../../src/noxijent"
import { cleanup, rejects, temprepo } from "./helpers"

afterEach(cleanup)

describe("worktree", () => {
  it("creates an isolated worktree and branch per agent", async () => {
    const repo = await temprepo()
    const info = await Worktree.create({ repo, agent: "Backend Coder" })

    expect(info.agent).toBe("backend-coder")
    expect(info.branch).toBe("noxijent/agent/backend-coder")
    expect(info.directory).toBe(path.join(repo, ".noxijent", "state", "worktrees", "backend-coder"))

    const inside = await $`ls ${info.directory}`.text()
    expect(inside).toContain("file.txt")

    const branch = await $`git -C ${repo} branch --list noxijent/agent/backend-coder`.text()
    expect(branch).toContain("noxijent/agent/backend-coder")
  })

  it("lists only managed worktrees", async () => {
    const repo = await temprepo()
    await Worktree.create({ repo, agent: "frontend" })
    await Worktree.create({ repo, agent: "backend" })

    const managed = await Worktree.listManaged({ repo })
    expect(managed.map((item) => item.agent).sort()).toEqual(["backend", "frontend"])

    const all = await Worktree.list({ repo })
    expect(all.length).toBe(3)
    expect(all.filter((item) => item.managed).length).toBe(2)
    expect(all.find((item) => !item.managed)?.branch).toBe("main")
  })

  it("reports status of an agent worktree", async () => {
    const repo = await temprepo()
    const info = await Worktree.create({ repo, agent: "tester" })

    const before = await Worktree.status({ repo, agent: "tester" })
    expect(before.changes).toEqual([])

    await Bun.write(path.join(info.directory, "new.ts"), "export const x = 1\n")
    const after = await Worktree.status({ repo, agent: "tester" })
    expect(after.changes.length).toBe(1)
    expect(after.changes[0]).toContain("new.ts")
  })

  it("keeps working trees isolated between agents and the main checkout", async () => {
    const repo = await temprepo()
    const info = await Worktree.create({ repo, agent: "isolated" })
    await Bun.write(path.join(info.directory, "agent-only.txt"), "x\n")

    const mainStatus = await $`git -C ${repo} status --porcelain`.text()
    expect(mainStatus.trim()).toBe("")
  })

  it("refuses to create the same agent twice", async () => {
    const repo = await temprepo()
    await Worktree.create({ repo, agent: "dup" })
    await rejects(Worktree.create({ repo, agent: "dup" }), "already exists")
  })

  it("removes worktree and branch", async () => {
    const repo = await temprepo()
    await Worktree.create({ repo, agent: "gone" })
    await Worktree.remove({ repo, agent: "gone" })

    const managed = await Worktree.listManaged({ repo })
    expect(managed).toEqual([])

    const branch = await $`git -C ${repo} branch --list noxijent/agent/gone`.text()
    expect(branch.trim()).toBe("")
  })

  it("keeps the branch when requested", async () => {
    const repo = await temprepo()
    await Worktree.create({ repo, agent: "keep" })
    await Worktree.remove({ repo, agent: "keep", keepBranch: true })

    const branch = await $`git -C ${repo} branch --list noxijent/agent/keep`.text()
    expect(branch).toContain("noxijent/agent/keep")
  })

  it("throws for a repository without commits", async () => {
    const { tempdir } = await import("./helpers")
    const dir = await tempdir()
    await $`git -C ${dir} init -q -b main`.quiet()
    await rejects(Worktree.create({ repo: dir, agent: "x" }), "at least one commit")
  })
})
