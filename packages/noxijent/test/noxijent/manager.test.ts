import { afterEach, describe, expect, it } from "bun:test"
import { Manager } from "../../src/noxijent"
import { cleanup, rejects, tempdir } from "./helpers"

afterEach(cleanup)

describe("manager", () => {
  it("decomposes a full-stack task into the needed roles only", () => {
    const plan = Manager.decomposeHeuristic("add oauth auth to the api with a new login screen and tests")
    const roles = plan.assignments.map((assignment) => assignment.role)

    expect(roles[0]).toBe("explorer")
    expect(roles[roles.length - 1]).toBe("integrator")
    expect(roles).toContain("backend")
    expect(roles).toContain("frontend")
    expect(roles).toContain("tester")
    expect(roles).toContain("security")
    expect(roles).not.toContain("architect")
  })

  it("spawns only relevant roles for a narrow task", () => {
    const plan = Manager.decomposeHeuristic("fix the css of the settings page component")
    const roles = plan.assignments.map((assignment) => assignment.role)

    expect(roles).toEqual(["explorer", "frontend", "reviewer", "integrator"])
  })

  it("falls back to a single general builder when no specialty matches", () => {
    const plan = Manager.decomposeHeuristic("improve performance")
    const roles = plan.assignments.map((assignment) => assignment.role)

    expect(roles).toEqual(["explorer", "backend", "reviewer", "integrator"])
  })

  it("converts plans to a valid execution graph", () => {
    const plan = Manager.decomposeHeuristic("add database endpoint with tests")
    const graph = Manager.graphOf("task", plan)
    expect(graph.nodes.length).toBe(plan.assignments.length)
  })

  it("rejects plans assigning the same role twice", () => {
    const plan = {
      summary: "x",
      assignments: [
        { role: "backend", task: "a", dependsOn: [] },
        { role: "backend", task: "b", dependsOn: [] },
      ],
    }
    expect(() => Manager.graphOf("task", plan)).toThrow("more than once")
  })

  it("rejects plans with unknown role dependencies", () => {
    const plan = {
      summary: "x",
      assignments: [{ role: "backend", task: "a", dependsOn: ["ghost"] }],
    }
    expect(() => Manager.graphOf("task", plan)).toThrow("unassigned role")
  })

  it("validates custom decomposer output", async () => {
    await rejects(
      Manager.decompose("task", () => ({ summary: "", assignments: [] })),
      "invalid manager plan",
    )
  })

  it("runs a plan end to end through the execution graph", async () => {
    const repo = await tempdir()
    const executed: string[] = []
    const { plan, graph } = await Manager.manage({
      repo,
      taskName: "feature",
      task: "add security token handling to the backend with tests",
      executor: async (node) => {
        executed.push(node.id)
      },
    })

    expect(executed[0]).toBe("explorer")
    expect(executed[executed.length - 1]).toBe("integrator")
    expect(graph.nodes.every((node) => node.status === "done")).toBe(true)
    expect(plan.summary).toContain("security")
  })

  it("reports node statuses after a run", async () => {
    const repo = await tempdir()
    const { graph } = await Manager.manage({
      repo,
      taskName: "report",
      task: "improve performance",
      executor: async () => undefined,
    })
    const report = Manager.report(graph)
    expect(report.finished).toBe(true)
    expect(report.nodes.map((node) => node.id)).toContain("integrator")
  })
})
