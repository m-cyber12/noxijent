import { afterEach, describe, expect, it } from "bun:test"
import { Events, Graph } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

const nodes = [
  { id: "a", description: "first", dependencies: [], agent: "explorer" },
  { id: "b", description: "second", dependencies: ["a"], agent: "backend" },
  { id: "c", description: "third", dependencies: ["a"], agent: "frontend" },
  { id: "d", description: "fourth", dependencies: ["b", "c"], agent: "integrator" },
]

describe("graph", () => {
  it("validates input: duplicates, unknown deps, cycles", () => {
    expect(() => Graph.create("t", [nodes[0]!, nodes[0]!])).toThrow("duplicate")
    expect(() => Graph.create("t", [{ id: "x", description: "x", dependencies: ["ghost"], agent: "a" }])).toThrow(
      "unknown node",
    )
    expect(() => Graph.create("t", [{ id: "x", description: "x", dependencies: ["x"], agent: "a" }])).toThrow("itself")
    expect(() =>
      Graph.create("t", [
        { id: "x", description: "x", dependencies: ["y"], agent: "a" },
        { id: "y", description: "y", dependencies: ["x"], agent: "a" },
      ]),
    ).toThrow("cycle")
    expect(() => Graph.create("t", [])).toThrow("zero nodes")
  })

  it("computes topological layers and ready nodes", () => {
    const graph = Graph.create("t", nodes)
    expect(Graph.layers(graph)).toEqual([["a"], ["b", "c"], ["d"]])
    expect(Graph.ready(graph).map((node) => node.id)).toEqual(["a"])
    graph.nodes.find((node) => node.id === "a")!.status = "done"
    expect(
      Graph.ready(graph)
        .map((node) => node.id)
        .sort(),
    ).toEqual(["b", "c"])
  })

  it("executes layers in order, with parallelism inside a layer", async () => {
    const repo = await tempdir()
    const order: string[] = []
    const running = new Set<string>()
    let maxParallel = 0

    const graph = Graph.create("parallel", nodes)
    const finished = await Graph.run(repo, graph, async (node) => {
      running.add(node.id)
      maxParallel = Math.max(maxParallel, running.size)
      await Bun.sleep(20)
      order.push(node.id)
      running.delete(node.id)
      return `result-${node.id}`
    })

    expect(order[0]).toBe("a")
    expect(order[3]).toBe("d")
    expect(maxParallel).toBe(2)
    expect(finished.nodes.every((node) => node.status === "done")).toBe(true)
    expect(Graph.summary(finished).finished).toBe(true)
  })

  it("retries failing nodes and skips dependents after final failure", async () => {
    const repo = await tempdir()
    let attempts = 0
    const graph = Graph.create("fail", nodes)
    const finished = await Graph.run(
      repo,
      graph,
      async (node) => {
        if (node.id !== "b") return
        attempts++
        throw new Error("boom")
      },
      { retries: 1 },
    )

    expect(attempts).toBe(2)
    const byId = new Map(finished.nodes.map((node) => [node.id, node.status]))
    expect(byId.get("b")).toBe("failed")
    expect(byId.get("d")).toBe("skipped")
    expect(byId.get("c")).toBe("done")

    const events = await Events.read(repo, { event: /^graph\./ })
    expect(events.map((event) => event.event)).toContain("graph.node.retry")
    expect(events.map((event) => event.event)).toContain("graph.node.failed")
  })

  it("persistently saves state and resumes an interrupted graph", async () => {
    const repo = await tempdir()
    const graph = Graph.create("resume", nodes)

    const aborted = new AbortController()
    let calls = 0
    await Graph.run(
      repo,
      graph,
      async () => {
        calls++
        if (calls === 2) aborted.abort()
      },
      { signal: aborted.signal },
    )

    const reloaded = await Graph.load(repo, "resume")
    expect(reloaded).not.toBeUndefined()
    const doneBefore = reloaded!.nodes.filter((node) => node.status === "done").map((node) => node.id)
    expect(doneBefore).toContain("a")

    const executed: string[] = []
    const finished = await Graph.run(repo, reloaded!, async (node) => {
      executed.push(node.id)
    })
    expect(Graph.summary(finished).finished).toBe(true)
    expect(executed).not.toContain("a")
    expect(executed).toContain("d")
  })

  it("resets a single node for re-run", async () => {
    const repo = await tempdir()
    const graph = Graph.create("rerun", nodes)
    const finished = await Graph.run(repo, graph, async () => undefined)

    Graph.reset(finished, "a", { cascade: true })
    expect(finished.nodes.every((node) => node.status === "pending")).toBe(true)

    const rerun: string[] = []
    await Graph.run(repo, finished, async (node) => {
      rerun.push(node.id)
    })
    expect(rerun.length).toBe(4)
  })

  it("throws when reset targets an unknown node", () => {
    const graph = Graph.create("t", nodes)
    expect(() => Graph.reset(graph, "ghost")).toThrow("no node")
  })
})
