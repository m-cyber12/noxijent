import { afterEach, describe, expect, it } from "bun:test"
import { Routing } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

describe("routing", () => {
  it("ships a working default catalog", async () => {
    const repo = await tempdir()
    const models = await Routing.catalog(repo)
    expect(models.length).toBeGreaterThanOrEqual(5)
    expect(models.map((model) => model.name)).toContain("reasoning-model")
  })

  it("routes tasks to the strength they call for", () => {
    expect(Routing.strengthFor("rename a typo in the header")).toBe("fast-edit")
    expect(Routing.strengthFor("design the auth schema migration")).toBe("reasoning")
    expect(Routing.strengthFor("review this security token flow for xss")).toBe("security")
    expect(Routing.strengthFor("document the whole repo structure")).toBe("long-context")
    expect(Routing.strengthFor("implement the payments endpoint")).toBe("coding")
  })

  it("picks the strong model for the inferred task strength", () => {
    const choice = Routing.choose(Routing.DEFAULT_CATALOG, "fix typo in the navbar")
    expect(choice.model.name).toBe("local-fast-model")
    expect(choice.strength).toBe("fast-edit")
    expect(choice.reasons.join(" ")).toContain("fast-edit")
    expect(choice.alternatives.length).toBeGreaterThan(0)
  })

  it("prefers cheaper models when optimizing for cost", () => {
    const models: Routing.Model[] = [
      { name: "premium", tier: 5, costTier: 3, latencyTier: 2, contextWindow: 1_000_000, strengths: ["coding"] },
      { name: "budget", tier: 2, costTier: 1, latencyTier: 1, contextWindow: 50_000, strengths: ["coding"] },
    ]
    expect(Routing.choose(models, "implement endpoint", { prefer: "quality" }).model.name).toBe("premium")
    expect(Routing.choose(models, "implement endpoint", { prefer: "cost" }).model.name).toBe("budget")

    const cheap = Routing.choose(Routing.DEFAULT_CATALOG, "rename the button label", { prefer: "cost" })
    expect(cheap.model.name).toBe("local-fast-model")
    expect(cheap.model.costTier).toBe(1)
  })

  it("prefers fast models when optimizing for latency", () => {
    const choice = Routing.choose(Routing.DEFAULT_CATALOG, "implement the payments endpoint", { prefer: "latency" })
    expect(choice.model.name).toBe("local-fast-model")
    expect(choice.model.latencyTier).toBe(1)
  })

  it("honors hard constraints and reports when none fit", () => {
    expect(
      Routing.choose(Routing.DEFAULT_CATALOG, "document the whole repo", { contextSize: 500_000 }).model.name,
    ).toBe("long-context-model")
    expect(() => Routing.choose(Routing.DEFAULT_CATALOG, "x", { minTier: 6 })).toThrow("no model satisfies")
  })

  it("maps manager roles to strengths and routes them", async () => {
    const repo = await tempdir()
    expect(Routing.strengthForRole("architect")).toBe("reasoning")
    expect(Routing.strengthForRole("security")).toBe("security")
    expect(Routing.strengthForRole("explorer")).toBe("long-context")

    const choice = await Routing.routeRole(repo, "reviewer")
    expect(choice.model.name).toBe("security-model")
    expect(choice.reasons[0]).toContain("role reviewer")
    await expect(Routing.routeRole(repo, "nope")).rejects.toThrow("unknown role")
  })

  it("merges project overrides from .noxijent/models.json", async () => {
    const repo = await tempdir()
    const { mkdir } = await import("node:fs/promises")
    await mkdir(`${repo}/.noxijent`, { recursive: true })
    await Bun.write(
      `${repo}/.noxijent/models.json`,
      JSON.stringify({
        models: [
          {
            name: "coding-model",
            tier: 4,
            costTier: 1,
            latencyTier: 1,
            contextWindow: 50_000,
            strengths: ["coding", "fast-edit"],
          },
          { name: "custom-model", tier: 5, costTier: 3, latencyTier: 3, contextWindow: 10_000, strengths: [] },
        ],
      }),
    )

    const models = await Routing.catalog(repo)
    const overridden = models.find((model) => model.name === "coding-model")!
    expect(overridden.tier).toBe(4)
    expect(models.some((model) => model.name === "custom-model")).toBe(true)

    const choice = await Routing.route(repo, "implement the endpoint")
    expect(choice.model.tier).toBeGreaterThanOrEqual(4)
  })

  it("rejects invalid project catalogs", async () => {
    const repo = await tempdir()
    const { mkdir } = await import("node:fs/promises")
    await mkdir(`${repo}/.noxijent`, { recursive: true })
    await Bun.write(`${repo}/.noxijent/models.json`, JSON.stringify({ models: "nope" }))
    await expect(Routing.catalog(repo)).rejects.toThrow("invalid .noxijent/models.json")
  })

  it("ranks alternatives deterministically", async () => {
    const repo = await tempdir()
    const first = await Routing.route(repo, "design the plugin api")
    const second = await Routing.route(repo, "design the plugin api")
    expect(first.model.name).toBe(second.model.name)
    expect(first.alternatives.map((model) => model.name)).toEqual(second.alternatives.map((model) => model.name))
  })
})
