import { afterEach, describe, expect, it } from "bun:test"
import path from "path"
import { Risk } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

describe("risk", () => {
  it("classifies read-only actions as low risk", () => {
    expect(Risk.classify("read", "src/index.ts").level).toBe("low")
    expect(Risk.classify("grep", "pattern").level).toBe("low")
    expect(Risk.classify("bash", "git status").level).toBe("low")
    expect(Risk.classify("bash", "bun test --timeout 30000").level).toBe("low")
    expect(Risk.classify("bash", "ls -la").level).toBe("low")
  })

  it("classifies local mutations as medium risk", () => {
    expect(Risk.classify("edit", "src/index.ts").level).toBe("medium")
    expect(Risk.classify("write", "src/new.ts").level).toBe("medium")
    expect(Risk.classify("bash", "bun install").level).toBe("medium")
    expect(Risk.classify("bash", "git commit -m msg").level).toBe("medium")
    expect(Risk.classify("bash", "some-unknown-command").level).toBe("medium")
  })

  it("classifies destructive and external actions as high or critical risk", () => {
    expect(Risk.classify("bash", "rm -rf build/").level).toBe("high")
    expect(Risk.classify("bash", "rm file.txt").level).toBe("high")
    expect(Risk.classify("bash", "git push origin main").level).toBe("high")
    expect(Risk.classify("bash", "git push --force origin main").level).toBe("critical")
    expect(Risk.classify("bash", "rm -rf /").level).toBe("critical")
    expect(Risk.classify("bash", "terraform apply -auto-approve").level).toBe("critical")
    expect(Risk.classify("bash", "vercel deploy --prod").level).toBe("critical")
  })

  it("protects secrets even for reads", () => {
    expect(Risk.classify("read", ".env").level).toBe("high")
    expect(Risk.classify("read", "config/prod.pem").level).toBe("high")
    expect(Risk.classify("bash", "cat .env.local").level).toBe("high")
  })

  it("judges compound commands by their worst segment", () => {
    expect(Risk.classify("bash", "ls && rm -rf build/").level).toBe("high")
    expect(Risk.classify("bash", "git status; git commit -m x").level).toBe("medium")
    expect(Risk.classify("bash", "echo a | sudo tee /etc/x").level).toBe("high")
    expect(Risk.classify("bash", "ls\ngit status").level).toBe("low")
  })

  it("falls back to medium for unknown tools", () => {
    expect(Risk.classify("custom-mcp-tool").level).toBe("medium")
    expect(Risk.classify("custom-mcp-tool").source).toBe("fallback")
  })

  it("maps levels to decisions through the default policy", () => {
    expect(Risk.decide("read", "file.ts").decision).toBe("allow")
    expect(Risk.decide("edit", "file.ts").decision).toBe("ask")
    expect(Risk.decide("bash", "rm -rf node_modules").decision).toBe("ask")
    expect(Risk.decide("bash", "rm -rf /").decision).toBe("deny")
  })

  it("honours repository policy and override config", async () => {
    const repo = await tempdir()
    const { mkdir } = await import("node:fs/promises")
    await mkdir(path.join(repo, ".noxijent"), { recursive: true })
    await Bun.write(
      path.join(repo, ".noxijent", "risk.jsonc"),
      `{
        // relax medium and high to autonomous, keep critical denied
        "policy": { "medium": "allow", "high": "allow" },
        "overrides": [
          { "match": "bash:rm -rf node_modules*", "level": "low", "reason": "dependency prune is routine" }
        ]
      }`,
    )

    const config = await Risk.load(repo)
    expect(config).not.toBeUndefined()

    const prune = Risk.decide("bash", "rm -rf node_modules", config)
    expect(prune.level).toBe("low")
    expect(prune.source).toBe("override")
    expect(prune.decision).toBe("allow")

    expect(Risk.decide("edit", "file.ts", config).decision).toBe("allow")
    expect(Risk.decide("bash", "rm -rf /", config).decision).toBe("deny")
    expect(Risk.decide("bash", "git push origin main", config).decision).toBe("allow")
  })

  it("returns undefined configuration for repositories without an override file", async () => {
    const repo = await tempdir()
    expect(await Risk.load(repo)).toBeUndefined()
  })
})
