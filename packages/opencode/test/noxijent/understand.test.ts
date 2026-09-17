import { afterEach, describe, expect, it } from "bun:test"
import { Understand } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

async function seed(repo: string) {
  const { mkdir } = await import("node:fs/promises")
  await mkdir(`${repo}/src/api`, { recursive: true })
  await mkdir(`${repo}/src/domain`, { recursive: true })
  await mkdir(`${repo}/src/db`, { recursive: true })
  await mkdir(`${repo}/test`, { recursive: true })
  await mkdir(`${repo}/.github/workflows`, { recursive: true })

  await Bun.write(
    `${repo}/package.json`,
    JSON.stringify({
      name: "demo",
      packageManager: "bun@1.3.0",
      scripts: { test: "bun test", dev: "bun run src/main.ts" },
    }),
  )
  await Bun.write(`${repo}/bun.lock`, "{}")
  await Bun.write(`${repo}/src/main.ts`, `import { api } from "./api/index"\napi()\n`)
  await Bun.write(
    `${repo}/src/api/index.ts`,
    `import { repo } from "../db/repo"\nimport { svc } from "../domain/svc"\nexport function api() { return repo() + svc() }\n`,
  )
  await Bun.write(`${repo}/src/db/repo.ts`, `export function repo() { return 1 }\n`)
  await Bun.write(
    `${repo}/src/domain/svc.ts`,
    `import { repo } from "../db/repo"\nexport function svc() { return repo() }\n`,
  )
  await Bun.write(`${repo}/test/repo.test.ts`, `import { repo } from "../src/db/repo"\n`)
  await Bun.write(`${repo}/.github/workflows/ci.yml`, "name: ci\n")
  await Bun.write(`${repo}/README.md`, "# demo\n")
}

describe("understand", () => {
  it("maps languages, structure and manifests", async () => {
    const repo = await tempdir()
    await seed(repo)
    const report = await Understand.analyze(repo)

    expect(report.files.byLanguage["typescript"]).toBe(5)
    expect(report.files.byLanguage["yaml"]).toBe(1)
    expect(report.structure.topLevel).toContain("src")
    expect(report.manifests.name).toBe("demo")
    expect(report.manifests.packageManager).toBe("bun@1.3.0")
    expect(report.manifests.packageScripts.test).toBe("bun test")
    expect(report.manifests.ciSystems).toContain("github-actions")
    expect(report.manifests.isGit).toBe(false)
  })

  it("builds the import graph and finds hubs", async () => {
    const repo = await tempdir()
    await seed(repo)
    const report = await Understand.analyze(repo)

    expect(report.architecture.importEdges).toBeGreaterThanOrEqual(4)
    const hub = report.architecture.importHubs[0]
    expect(hub?.path).toBe("src/db/repo.ts")
    expect(hub?.importedBy).toBe(3)
    expect(report.architecture.entrypoints).toContain("src/main.ts")
  })

  it("detects tests", async () => {
    const repo = await tempdir()
    await seed(repo)
    const report = await Understand.analyze(repo)

    expect(report.tests.files).toContain("test/repo.test.ts")
    expect(report.tests.directories).toContain("test")
  })

  it("renders a readable report with all sections", async () => {
    const repo = await tempdir()
    await seed(repo)
    const report = await Understand.analyze(repo)
    const text = Understand.render(report)

    for (const section of ["Languages", "Structure", "Architecture", "Critical paths", "Tests", "Technical debt"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("hub: src/db/repo.ts")
  })

  it("skips node_modules and .git", async () => {
    const repo = await tempdir()
    await seed(repo)
    const { mkdir } = await import("node:fs/promises")
    await mkdir(`${repo}/node_modules/junk`, { recursive: true })
    await Bun.write(`${repo}/node_modules/junk/x.ts`, "export {}\n")

    const report = await Understand.analyze(repo)
    expect(report.files.byLanguage["typescript"]).toBe(5)
  })
})
