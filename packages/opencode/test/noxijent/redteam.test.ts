import { afterEach, describe, expect, it } from "bun:test"
import { Events, Redteam } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

const DIFF = (body: string) => `diff --git a/src/auth/token.ts b/src/auth/token.ts
index 1111111..2222222 100644
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -9,4 +9,6 @@ export function issue() {
${body}
`

const ADD = (lines: string[]) => lines.map((line) => `+${line}`).join("\n")

describe("redteam", () => {
  it("parses added lines with file and line numbers", () => {
    const added = Redteam.parseAddedLines(DIFF(ADD(["const a = 1", "const b = 2"])))
    expect(added).toEqual([
      { file: "src/auth/token.ts", line: 9, text: "const a = 1" },
      { file: "src/auth/token.ts", line: 10, text: "const b = 2" },
    ])
  })

  it("flags committed secrets as errors", () => {
    const findings = Redteam.preview(DIFF(ADD([`const key = "AKIAIOSFODNN7EXAMPLE"`])))
    const secret = findings.find((finding) => finding.rule === "secret-pattern")
    expect(secret).not.toBeUndefined()
    expect(secret!.severity).toBe("error")
    expect(secret!.detail).toContain("aws access key")

    const pem = Redteam.preview(DIFF(ADD(["-----BEGIN PRIVATE KEY-----"])))
    expect(pem.some((finding) => finding.rule === "secret-pattern")).toBe(true)

    const password = Redteam.preview(DIFF(ADD([`const password = "hunter22-ok-very-long"`])))
    expect(password.some((finding) => finding.rule === "secret-pattern")).toBe(true)
  })

  it("flags invisible bidi characters as errors", () => {
    const bidi = String.fromCharCode(0x202e)
    const findings = Redteam.preview(DIFF(ADD([`const s = 'safe${bidi} text'`])))
    expect(findings.some((finding) => finding.rule === "unicode-smuggling")).toBe(true)
  })

  it("flags debug leftovers in source but not in tests", () => {
    const source = Redteam.preview(DIFF(ADD(["console.log('ship it')"])))
    expect(source.some((finding) => finding.rule === "debug-leftover")).toBe(true)

    const testDiff = DIFF(ADD(["console.log('probe')"])).replaceAll("src/auth/token.ts", "src/auth/token.test.ts")
    const tests = Redteam.preview(testDiff)
    expect(tests.some((finding) => finding.rule === "debug-leftover")).toBe(false)
    expect(tests.some((finding) => finding.rule === "missing-tests")).toBe(false)
  })

  it("flags missing tests when only source files change", () => {
    const findings = Redteam.preview(DIFF(ADD(["export const x = 1"])))
    const missing = findings.find((finding) => finding.rule === "missing-tests")
    expect(missing).not.toBeUndefined()
    expect(missing!.severity).toBe("warning")
    expect(missing!.detail).toContain("src/auth/token.ts")
  })

  it("flags risky patterns", () => {
    const findings = Redteam.preview(
      DIFF(ADD(["const out = eval(userInput())", "element.dangerouslySetInnerHTML = raw"])),
    )
    expect(findings.filter((finding) => finding.rule === "risky-pattern").length).toBe(2)
  })

  it("flags bare markers but not described ones", () => {
    const bare = Redteam.preview(DIFF(ADD(["// TODO"])))
    expect(bare.some((finding) => finding.rule === "todo-bomb")).toBe(true)

    const described = Redteam.preview(DIFF(ADD(["// TODO: track quota after sdk upgrade"])))
    expect(described.some((finding) => finding.rule === "todo-bomb")).toBe(false)
  })

  it("flags deletion-heavy changesets as info", () => {
    const body =
      ADD(["const keep = 1"]) +
      "\n" +
      ["one", "two", "three", "four", "five"].map((line) => `-const gone_${line} = 1`).join("\n")
    const findings = Redteam.preview(DIFF(body))
    expect(findings.some((finding) => finding.rule === "regression-risk")).toBe(true)
  })

  it("sorts findings by severity, then file, then line", () => {
    const diff = DIFF(ADD(["console.log('x')", `const key = "AKIAIOSFODNN7EXAMPLE"`]))
    const findings = Redteam.preview(diff)
    expect(findings[0]!.severity).toBe("error")
    expect(findings[findings.length - 1]!.severity).not.toBe("error")
  })

  it("verdict aggregates counts and emits a review event", async () => {
    const repo = await tempdir()
    const clean = await Redteam.verdict(repo, DIFF(ADD(["export const x = 1"])))
    expect(clean.ok).toBe(true)
    expect(clean.counts).toEqual({ error: 0, warning: 1, info: 0 })

    const dirty = await Redteam.verdict(repo, DIFF(ADD([`const key = "ASIAIOSFODNN7EXAMPLE"`])), "task-9")
    expect(dirty.ok).toBe(false)
    expect(dirty.counts.error).toBeGreaterThanOrEqual(1)

    const events = await Events.read(repo, { event: "redteam.reviewed" })
    expect(events.length).toBe(2)
    expect(events[1]!.task).toBe("task-9")
    expect(events[1]!.data).toMatchObject({ ok: false })
  })

  it("reads diffs from git when reviewing a repository", async () => {
    const { temprepo } = await import("./helpers")
    const { $ } = await import("bun")
    const repo = await temprepo()
    await Bun.write(`${repo}/file.txt`, "hello\nconsole.log('debug me')\n")
    await $`git -C ${repo} add file.txt`.quiet()

    const review = await Redteam.review(repo, { staged: true })
    expect(review.findings.some((finding) => finding.rule === "debug-leftover")).toBe(true)

    const unstaged = await Redteam.verdict(repo, "")
    expect(unstaged.findings).toEqual([])
    expect(unstaged.ok).toBe(true)
  })
})
