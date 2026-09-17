import { afterEach, describe, expect, it } from "bun:test"
import { Events, Context } from "../../src/noxijent"
import { cleanup, temprepo } from "./helpers"

afterEach(cleanup)

describe("context.rankPaths (pure ranking)", () => {
  const files = [
    "src/api/auth/oauth.ts",
    "src/api/auth/session.ts",
    "src/api/payments/stripe.ts",
    "src/web/theme/button.tsx",
    "test/oauth.test.ts",
    "docs/guide.md",
  ]

  it("ranks name matches above directory matches", () => {
    const ranked = Context.rankPaths(files, "stripe refund")
    expect(ranked[0]!.file).toBe("src/api/payments/stripe.ts")
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]?.score ?? 0)
    expect(Context.rankPaths(files, "oauth login")[0]!.file).toBe("src/api/auth/oauth.ts")
  })

  it("matches directory segments and stems", () => {
    const ranked = Context.rankPaths(files, "auth session fix")
    expect(ranked.map((entry) => entry.file)).toContain("src/api/auth/session.ts")
    expect(ranked.find((entry) => entry.file === "src/api/auth/session.ts")?.reasons).toContain("dir:auth")
  })

  it("returns empty for unrelated queries and caps results", () => {
    expect(Context.rankPaths(files, "kubernetes helm chart")).toEqual([])
    expect(Context.rankPaths(files, "a b auth oauth session stripe theme button test", { maxFiles: 2 }).length).toBe(2)
  })
})

describe("context.rank (repository-aware)", () => {
  it("ranks direct matches first and pulls related tests along", async () => {
    const { mkdir } = await import("node:fs/promises")
    const repo = await temprepo()
    await mkdir(`${repo}/src/auth`, { recursive: true })
    await Bun.write(`${repo}/src/auth/token.ts`, "export const t = 1\n")
    await Bun.write(`${repo}/src/auth/token.test.ts`, "export {}\n")
    await Bun.write(`${repo}/src/unrelated/blob.ts`, "export const b = 1\n")

    const ranked = await Context.rank({ repo, query: "token handling" })
    expect(ranked[0]!.file).toBe("src/auth/token.ts")
    expect(ranked.map((entry) => entry.file)).toContain("src/auth/token.test.ts")
    expect(ranked.map((entry) => entry.file)).not.toContain("src/unrelated/blob.ts")
  })

  it("boosts files from previous failures", async () => {
    const repo = await temprepo()
    await Bun.write(`${repo}/src-a.ts`, "export {}\n")
    await Bun.write(`${repo}/src-b.ts`, "export {}\n")

    const plain = await Context.rank({ repo, query: "src" })
    const boosted = await Context.rank({ repo, query: "src", previousFailures: ["src-b.ts"] })
    const bScore = boosted.find((entry) => entry.file === "src-b.ts")?.score ?? 0
    const bPlain = plain.find((entry) => entry.file === "src-b.ts")?.score ?? 0
    expect(bScore).toBeGreaterThan(bPlain)
    expect(boosted.find((entry) => entry.file === "src-b.ts")?.reasons).toContain("previous-failure")
  })

  it("respects the byte budget but never returns empty-handed", async () => {
    const repo = await temprepo()
    const big = "x".repeat(4096)
    await Bun.write(`${repo}/zbig-match.ts`, big)
    await Bun.write(`${repo}/asmall-match.ts`, "x")

    const ranked = await Context.rank({ repo, query: "match", maxBytes: 2048 })
    const names = ranked.map((entry) => entry.file)
    expect(names).toContain("asmall-match.ts")
    expect(names).not.toContain("zbig-match.ts")

    const empty = await Context.rank({ repo, query: "zbig", maxBytes: 8 })
    expect(empty.map((entry) => entry.file)).toEqual(["zbig-match.ts"])
  })

  it("snapshots the selection and emits an event", async () => {
    const repo = await temprepo()
    await Bun.write(`${repo}/target.ts`, "export {}\n")

    const snap = await Context.snapshot({ repo, query: "target", task: "demo" })
    expect(snap.files[0]!.file).toBe("target.ts")

    const stored = Bun.file(`${repo}/.noxijent/state/context/demo.json`)
    expect(await stored.exists()).toBe(true)

    const events = await Events.read(repo, { event: "context.selected" })
    expect(events.length).toBe(1)
    expect(events[0]!.data?.top).toEqual(["target.ts"])
  })
})
