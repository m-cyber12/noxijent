import { afterEach, describe, expect, it } from "bun:test"
import { Contradiction } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function fixture(repo: string, files: Record<string, string>) {
  const { mkdir } = await import("node:fs/promises")
  for (const [file, text] of Object.entries(files)) {
    const target = `${repo}/${file}`
    await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true })
    await Bun.write(target, text)
  }
}

describe("contradiction", () => {
  it("detects package manager conflicts between instructions, lockfiles and CI", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "AGENTS.md": "# Rules\n\nUse pnpm for everything.\n",
      "package.json": JSON.stringify({ name: "x", packageManager: "bun@1.3.0", scripts: {} }),
      "bun.lock": "{}",
      ".github/workflows/ci.yml": "steps:\n  - run: bun install\n",
    })

    const findings = await Contradiction.scan(repo)
    const conflict = findings.find((finding) => finding.rule === "package-manager-conflict")
    expect(conflict).not.toBeUndefined()
    expect(conflict!.severity).toBe("warning")
    expect(conflict!.summary).toContain("pnpm")
    expect(conflict!.summary).toContain("bun")
    expect(conflict!.evidence.length).toBeGreaterThanOrEqual(2)
  })

  it("stays quiet when the package manager story is consistent", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "AGENTS.md": "Use bun for everything.\n",
      "package.json": JSON.stringify({ name: "x", packageManager: "bun@1.3.0", scripts: { test: "bun test" } }),
      "bun.lock": "{}",
      ".github/workflows/ci.yml": "steps:\n  - run: bun install\n  - run: bun test\n",
    })

    const findings = await Contradiction.scan(repo)
    expect(findings.filter((finding) => finding.rule === "package-manager-conflict")).toEqual([])
  })

  it("detects outdated REST documentation when GraphQL is present", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "README.md": "# api\n\nThis is a REST API.\n",
      "schema.graphql": "type Query { ok: Boolean }\n",
    })

    const findings = await Contradiction.scan(repo)
    expect(findings.map((finding) => finding.rule)).toContain("api-style-conflict")
  })

  it("detects test runner mismatches between package.json and CI", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "package.json": JSON.stringify({ name: "x", scripts: { test: "bun test" } }),
      ".github/workflows/ci.yml": "steps:\n  - run: npm test\n",
    })

    const findings = await Contradiction.scan(repo)
    expect(findings.map((finding) => finding.rule)).toContain("test-runner-conflict")
  })

  it("detects node version mismatches", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      ".nvmrc": "20\n",
      "package.json": JSON.stringify({ name: "x", engines: { node: ">=22" } }),
    })

    const findings = await Contradiction.scan(repo)
    expect(findings.map((finding) => finding.rule)).toContain("node-version-conflict")
  })

  it("flags prose-style bun instructions contradicted by the packageManager field", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "AGENTS.md": "# Smoke\nUse bun for all package management.\n",
      "package.json": JSON.stringify({ name: "x", packageManager: "npm@9.0.0", scripts: { test: "bun test" } }),
      ".github/workflows/ci.yml": "steps:\n  - run: bun install\n",
    })

    const findings = await Contradiction.scan(repo)
    const conflict = findings.find((finding) => finding.rule === "package-manager-conflict")
    expect(conflict).not.toBeUndefined()
    expect(conflict!.summary).toContain("bun")
    expect(conflict!.summary).toContain("npm")
  })

  it("returns an empty list for a clean repo", async () => {
    const repo = await tempdir()
    await fixture(repo, { "README.md": "# nothing to see\n" })
    expect(await Contradiction.scan(repo)).toEqual([])
  })

  it("sorts findings by severity then rule", async () => {
    const repo = await tempdir()
    await fixture(repo, {
      "AGENTS.md": "Use pnpm.\n",
      "README.md": "This is a REST API.\n",
      "schema.graphql": "type Query { ok: Boolean }\n",
      "package.json": JSON.stringify({ name: "x", packageManager: "bun@1.0.0", scripts: {} }),
      "bun.lock": "{}",
    })

    const findings = await Contradiction.scan(repo)
    const severities = findings.map((finding) => finding.severity)
    expect(severities.indexOf("info")).toBeGreaterThan(severities.indexOf("warning"))
  })
})
