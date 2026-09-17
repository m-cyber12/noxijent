import { afterEach, describe, expect, it } from "bun:test"
import { Events, Graph, Teams } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

function agents(overrides: Record<string, Teams.AgentFn> = {}): Record<string, Teams.AgentFn> {
  return new Proxy(overrides, {
    get: (target, role: string) => target[role] ?? (async () => `done by ${role}`),
  }) as Record<string, Teams.AgentFn>
}

describe("teams", () => {
  it("executes a plan with per-role agents", async () => {
    const repo = await tempdir()
    const result = await Teams.execute(repo, {
      task: "add database endpoint with tests",
      agents: agents({
        backend: async () => "backend implementation",
        tester: async (node) => `tested ${node.id}`,
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.escalations).toEqual([])
    expect(result.report.nodes.every((node) => node.status === "done")).toBe(true)
    expect(result.report.nodes.find((node) => node.id === "backend")!.result).toBe("backend implementation")

    const events = await Events.read(repo, { event: "team.completed" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ nodes: result.report.nodes.length, escalations: 0 })

    const persisted = await Graph.load(repo, "add database endpoint with tests")
    expect(persisted).not.toBeUndefined()
  })

  it("escalates a failing role to its alternate instead of dying", async () => {
    const repo = await tempdir()
    let attempts = 0
    const result = await Teams.execute(repo, {
      task: "add database endpoint with tests",
      agents: agents({
        backend: async () => {
          attempts++
          throw new Error("db driver exploded")
        },
        reviewer: async () => "integrated by reviewer",
      }),
      alternates: { backend: ["reviewer"] },
    })

    expect(result.ok).toBe(true)
    expect(attempts).toBe(1)
    expect(result.escalations).toEqual([
      { node: "backend", from: "backend", to: "reviewer", reason: "previous role failed" },
    ])
    const backend = result.report.nodes.find((node) => node.id === "backend")!
    expect(backend.status).toBe("done")
    expect(backend.agent).toBe("reviewer")
    expect(backend.result).toBe("integrated by reviewer")

    const events = await Events.read(repo, { event: "team.escalated" })
    expect(events.length).toBe(1)
    expect(events[0]!.data).toMatchObject({ node: "backend", from: "backend", to: "reviewer" })
  })

  it("gives up when no alternate can recover the node", async () => {
    const repo = await tempdir()
    const result = await Teams.execute(repo, {
      task: "add database endpoint with tests",
      agents: agents({
        backend: async () => {
          throw new Error("permanent failure")
        },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.escalations).toEqual([])
    const backend = result.report.nodes.find((node) => node.id === "backend")!
    expect(backend.status).toBe("failed")
    const tester = result.report.nodes.find((node) => node.id === "tester")!
    expect(tester.status).toBe("skipped")

    const events = await Events.read(repo, { event: "team.failed" })
    expect(events.length).toBe(1)
  })

  it("never escalates past the node budget", async () => {
    const repo = await tempdir()
    const result = await Teams.execute(repo, {
      task: "add database endpoint with tests",
      agents: agents({
        backend: async () => {
          throw new Error("fail")
        },
        // frontend/deployer/qa are NOT planned roles for this task, so it is
        // safe to give them failing implementations as escalation targets
        frontend: async () => {
          throw new Error("also fail")
        },
        deployer: async () => {
          throw new Error("still fail")
        },
        qa: async () => {
          throw new Error("never reached")
        },
      }),
      alternates: { backend: ["frontend", "deployer", "qa"] },
      maxNodeEscalations: 2,
    })

    expect(result.ok).toBe(false)
    expect(result.escalations.map((entry) => entry.to)).toEqual(["frontend", "deployer"])
    const backend = result.report.nodes.find((node) => node.id === "backend")!
    expect(backend.status).toBe("failed")
    expect(backend.agent).toBe("deployer")
  })

  it("requires an agent for every planned role", async () => {
    const repo = await tempdir()
    await expect(
      Teams.execute(repo, { task: "add api with tests", agents: { backend: async () => 1 } }),
    ).rejects.toThrow("no agent registered for planned role")
  })

  it("honors a custom decomposer", async () => {
    const repo = await tempdir()
    const result = await Teams.execute(repo, {
      task: "simple",
      decomposer: async () => ({
        summary: "single builder plan",
        assignments: [{ role: "builder", task: "build it", dependsOn: [] }],
      }),
      agents: { builder: async () => "built" },
    })
    expect(result.ok).toBe(true)
    expect(result.report.nodes).toHaveLength(1)
    expect(result.report.nodes[0]!.result).toBe("built")
  })
})
