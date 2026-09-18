import { mkdir } from "node:fs/promises"
import { $ } from "bun"
import { afterEach, describe, expect, it } from "bun:test"
import { Archaeology } from "../../src/noxijent"
import { cleanup, temprepo } from "./helpers"

afterEach(cleanup)

async function seed(repo: string) {
  await mkdir(`${repo}/src`, { recursive: true })
  await mkdir(`${repo}/test`, { recursive: true })
  await Bun.write(`${repo}/src/legacy.ts`, "export const retries = 3\nexport const mode = 'strict'\n")
  await Bun.write(`${repo}/README.md`, "# legacy module\n")
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} -c user.name=alice -c user.email=alice@example.dev commit -m ${"add legacy retry helper"}`.quiet()

  await Bun.write(
    `${repo}/src/legacy.ts`,
    "export const retries = 3 // cap: hammering the API causes 429s (incident 2024)\nexport const mode = 'strict'\n",
  )
  await Bun.write(`${repo}/test/legacy.test.ts`, "export {}\n")
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} -c user.name=bob -c user.email=bob@example.dev commit -m ${"workaround: cap retries after api 429 incident"}`.quiet()
}

describe("archaeology", () => {
  it("blames a line range and attributes lines to authors", async () => {
    const repo = await temprepo()
    await seed(repo)

    const entries = await Archaeology.blame(repo, "src/legacy.ts", { from: 1, to: 1 })
    expect(entries.length).toBe(1)
    expect(entries[0]!.author).toBe("bob")
    expect(entries[0]!.line).toBe(1)

    const secondLine = await Archaeology.blame(repo, "src/legacy.ts", { from: 2, to: 2 })
    expect(secondLine[0]!.author).toBe("alice")
  })

  it("lists the commit history of a file, newest first", async () => {
    const repo = await temprepo()
    await seed(repo)

    const entries = await Archaeology.history(repo, "src/legacy.ts")
    expect(entries.length).toBe(2)
    expect(entries[0]!.subject).toBe("workaround: cap retries after api 429 incident")
    expect(entries[0]!.author).toBe("bob")
    expect(entries[1]!.subject).toBe("add legacy retry helper")
    expect(entries[1]!.author).toBe("alice")
    expect(entries.every((entry) => entry.commit.length === 40)).toBe(true)
  })

  it("explains a file: authors, history and tests that moved with it", async () => {
    const repo = await temprepo()
    await seed(repo)

    const report = await Archaeology.explain(repo, { file: "src/legacy.ts", from: 1, to: 1 })
    expect(report.range).toEqual({ from: 1, to: 1 })
    expect(report.authors).toEqual(["bob"])
    expect(report.subjects).toContain("workaround: cap retries after api 429 incident")
    expect(report.subjects).toContain("add legacy retry helper")
    expect(report.testsChanged).toEqual(["test/legacy.test.ts"])
    expect(report.boundaryCommit).toBe("workaround: cap retries after api 429 incident")

    const full = await Archaeology.explain(repo, { file: "src/legacy.ts" })
    expect(full.range).toEqual({ from: 1, to: 2 })
    expect(full.authors).toEqual(["alice", "bob"])

    const text = Archaeology.render(report)
    expect(text).toContain("Archaeology: src/legacy.ts (lines 1–1)")
    expect(text).toContain("authors: bob")
    expect(text).toContain("test/legacy.test.ts")
  })

  it("handles files whose history never touched tests", async () => {
    const repo = await temprepo()
    await Bun.write(`${repo}/solo.ts`, "export const x = 1\n")
    await $`git -C ${repo} add -A`.quiet()
    await $`git -C ${repo} -c user.name=solo -c user.email=solo@example.dev commit -m ${"plain file"}`.quiet()

    const report = await Archaeology.explain(repo, { file: "solo.ts" })
    expect(report.testsChanged).toEqual([])
    expect(report.authors).toEqual(["solo"])
    const text = Archaeology.render(report)
    expect(text).toContain("no test changes observed")
  })

  it("hasHistory distinguishes tracked from untracked paths", async () => {
    const repo = await temprepo()
    await Bun.write(`${repo}/tracked.txt`, "x\n")
    await $`git -C ${repo} add tracked.txt`.quiet()
    await $`git -C ${repo} commit -m ${"init"}`.quiet()

    expect(await Archaeology.hasHistory(repo, "tracked.txt")).toBe(true)
    expect(await Archaeology.hasHistory(repo, "missing.txt")).toBe(false)
  })

  it("throws a helpful error for files without git history", async () => {
    const repo = await temprepo()
    await expect(Archaeology.explain(repo, { file: "ghost.ts" })).rejects.toThrow("no git history")
  })
})
