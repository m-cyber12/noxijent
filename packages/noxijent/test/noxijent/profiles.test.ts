import { afterEach, describe, expect, it } from "bun:test"
import { Profiles } from "../../src/noxijent"
import { cleanup, tempdir } from "./helpers"

afterEach(cleanup)

describe("profiles", () => {
  it("defines and reads a profile", async () => {
    const repo = await tempdir()
    const profile = await Profiles.define(repo, {
      name: "security-reviewer",
      role: "security",
      model: "reasoning-model",
      permissions: { read: ["**/*"], write: false },
      checks: ["dependency-audit", "secret-detection", "auth-review"],
    })

    expect(profile.name).toBe("security-reviewer")
    expect(await Bun.file(`${repo}/.noxijent/profiles/security-reviewer.json`).exists()).toBe(true)

    const reloaded = await Profiles.get(repo, "security-reviewer")
    expect(reloaded.permissions.write).toBe(false)
    expect(reloaded.checks).toHaveLength(3)
  })

  it("normalizes for execution with manager role defaults", async () => {
    const repo = await tempdir()
    await Profiles.define(repo, { name: "reviewer-2", role: "reviewer" })
    const resolved = Profiles.resolve(await Profiles.get(repo, "reviewer-2"))

    expect(resolved.role).toBe("reviewer")
    expect(resolved.description).toBe("final independent review")
    expect(resolved.permissions).toEqual({ read: ["**/*"], write: true })
    expect(resolved.checks).toEqual([])
  })

  it("rejects unsafe names and unknown roles without descriptions", async () => {
    const repo = await tempdir()
    await expect(Profiles.define(repo, { name: "Bad Name" })).rejects.toThrow("kebab-case")
    await expect(Profiles.define(repo, { name: "wizard", role: "spellcasting" })).rejects.toThrow("unknown role")

    const custom = await Profiles.define(repo, {
      name: "wizard",
      role: "spellcasting",
      description: "casts refactorings",
    })
    expect(Profiles.resolve(custom).description).toBe("casts refactorings")
  })

  it("uses the profile name as role fallback", async () => {
    const repo = await tempdir()
    await Profiles.define(repo, { name: "tester", preamble: "be extra thorough" })
    const resolved = Profiles.resolve(await Profiles.get(repo, "tester"))
    expect(resolved.role).toBe("tester")
    expect(resolved.description).toBe("write and run tests")
    expect(resolved.preamble).toBe("be extra thorough")
  })

  it("lists profiles sorted by name", async () => {
    const repo = await tempdir()
    await Profiles.define(repo, { name: "zeta" })
    await Profiles.define(repo, { name: "alpha" })
    expect((await Profiles.list(repo)).map((profile) => profile.name)).toEqual(["alpha", "zeta"])
    expect(await Profiles.list(await tempdir())).toEqual([])
  })

  it("removes profiles and reports unknown ones", async () => {
    const repo = await tempdir()
    await Profiles.define(repo, { name: "tmp" })
    expect(await Profiles.remove(repo, "tmp")).toBe(true)
    expect(await Profiles.remove(repo, "tmp")).toBe(false)
    await expect(Profiles.get(repo, "tmp")).rejects.toThrow("no agent profile")
  })
})
