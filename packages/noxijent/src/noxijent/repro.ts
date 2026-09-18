// Automatic issue reproduction (roadmap §14 / Phase 3 #14): turn a bug
// report into a reproducible test scaffold. The context engine ranks
// suspect files from the issue text, then a failing-test scaffold is
// generated next to them under `.noxijent/state/repro/` — move it into the
// test tree once it reproduces. Scaffold stages mirror the roadmap loop:
// search code → inspect → find suspicious path → create reproduction.

import { readdir } from "node:fs/promises"
import path from "path"
import * as Context from "./context"
import { emit as emitEvent } from "./events"
import * as Paths from "./paths"
import * as Understand from "./understand"

export type Plan = {
  issue: string
  /** top suspect files for the issue text */
  suspects: Context.Ranked[]
  /** where the scaffold will be written */
  scaffoldPath: string
  stages: string[]
}

function dir(repo: string) {
  return Paths.stateDir(repo, "repro")
}

function scaffoldName(issue: string) {
  return `${Paths.slug(issue).slice(0, 60)}.test.ts`
}

async function report(repo: string) {
  return Understand.analyze(repo)
}

/** Rank suspects for an issue and describe where the scaffold will live. */
export async function plan(repo: string, issue: string, opts: { maxSuspects?: number } = {}): Promise<Plan> {
  const analysis = await report(repo)
  const suspects = await Context.rank({ repo, query: issue, report: analysis, maxFiles: opts.maxSuspects ?? 5 })
  return {
    issue,
    suspects,
    scaffoldPath: path.join(Paths.DIR, Paths.STATE, "repro", scaffoldName(issue)),
    stages: ["search code", "inspect logs", "find suspicious path", "create reproduction", "write failing test"],
  }
}

function scaffoldSource(plan: Plan, target: string | undefined) {
  const title = plan.issue.split("\n")[0]!.slice(0, 80)
  const suspects = plan.suspects.map(
    (entry, index) => `//   ${index + 1}) ${entry.file} (score ${entry.score}: ${entry.reasons.join(", ")})`,
  )
  const suggested = target ?? plan.suspects[0]?.file ?? "src/…"
  return [
    `// Automatic issue reproduction scaffold (noxijent repro)`,
    `// Issue: ${title}`,
    ...(suspects.length > 0
      ? [`// Suspect files (ranked by the context engine):`, ...suspects]
      : [`// No suspect files found by name — fill in the module under test.`]),
    ``,
    `// Once this reproduces the bug, move the file next to the project tests,`,
    `// keep it as the regression test, and mark the issue verified.`,
    ``,
    `import { describe, expect, it } from "bun:test"`,
    `// import { … } from ${JSON.stringify(`../${suggested}`)}`,
    ``,
    `describe(${JSON.stringify(`repro: ${title}`)}, () => {`,
    `  it.todo("reproduces the reported behavior")`,
    `  // it("reproduces the reported behavior", () => {`,
    `  //   expect(actual).toEqual(expected)`,
    `  // })`,
    `})`,
    ``,
  ].join("\n")
}

/** Write the reproduction scaffold and return its path (repo-relative). */
export async function scaffold(
  repo: string,
  issue: string,
  opts: { target?: string; maxSuspects?: number } = {},
): Promise<Plan> {
  const result = await plan(repo, issue, { maxSuspects: opts.maxSuspects })
  await Paths.ensureState(repo, "repro")
  await Bun.write(path.join(dir(repo), scaffoldName(issue)), scaffoldSource(result, opts.target))
  await emitEvent(repo, {
    event: "repro.scaffolded",
    data: { issue: issue.slice(0, 120), suspects: result.suspects.length },
  })
  return result
}

/** List reproduction scaffolds written in this repo. */
export async function list(repo: string): Promise<string[]> {
  const files = await readdir(dir(repo)).catch(() => [] as string[])
  return files.filter((entry) => entry.endsWith(".test.ts")).sort()
}
