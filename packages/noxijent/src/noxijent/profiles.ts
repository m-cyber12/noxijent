// Agent profiles (roadmap §27 / Phase 4 #23): reusable, shareable local
// agent definitions at `.noxijent/profiles/<name>.json` — role, model,
// permission envelope and named checks, so specialized agents become
// reproducible across projects.

import { readdir, readFile } from "node:fs/promises"
import path from "path"
import { z } from "zod"
import * as Manager from "./manager"

export const Profile = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** manager role this profile specializes (plus ").defaults to the name */
  role: z.string().optional(),
  model: z.string().optional(),
  preamble: z.string().optional(),
  permissions: z
    .object({
      read: z.array(z.string()).default(["**/*"]),
      write: z.union([z.boolean(), z.array(z.string())]).default(true),
    })
    .partial()
    .default({}),
  checks: z.array(z.string().min(1)).default([]),
})
export type Profile = z.infer<typeof Profile>

function dir(repo: string) {
  return path.join(repo, ".noxijent", "profiles")
}

function file(repo: string, name: string) {
  return path.join(dir(repo), `${name}.json`)
}

function assertSafeName(name: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error(`invalid profile name ${JSON.stringify(name)} (use kebab-case)`)
}

/** Create or update an agent profile. */
export async function define(repo: string, input: z.input<typeof Profile>): Promise<Profile> {
  const profile = Profile.parse(input)
  assertSafeName(profile.name)
  if (profile.role && !Manager.ROLES[profile.role]) {
    if (!profile.description)
      throw new Error(
        `unknown role ${JSON.stringify(profile.role)}: describe it or use one of ${Object.keys(Manager.ROLES).join(", ")}`,
      )
  }
  await Bun.write(file(repo, profile.name), JSON.stringify(profile, null, 2) + "\n")
  return profile
}

export async function get(repo: string, name: string): Promise<Profile> {
  const text = await readFile(file(repo, name), "utf8").catch(() => {
    throw new Error(`no agent profile named ${name}`)
  })
  try {
    return Profile.parse(JSON.parse(text))
  } catch {
    throw new Error(`corrupt agent profile ${name}`)
  }
}

export async function list(repo: string): Promise<Profile[]> {
  const entries = await readdir(dir(repo)).catch(() => [] as string[])
  const profiles: Profile[] = []
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    profiles.push(await get(repo, entry.slice(0, -".json".length)))
  }
  return profiles
}

export async function remove(repo: string, name: string): Promise<boolean> {
  const target = Bun.file(file(repo, name))
  if (!(await target.exists())) return false
  await import("node:fs/promises").then((fs) => fs.rm(file(repo, name)))
  return true
}

/**
 * Normalize a profile for execution: role defaults to the profile name,
 * write permission defaults to true, role description is filled from the
 * manager role registry when known.
 */
export function resolve(profile: Profile) {
  const role = profile.role ?? profile.name
  return {
    name: profile.name,
    role,
    description: profile.description ?? Manager.ROLES[role]?.description ?? `custom profile ${profile.name}`,
    model: profile.model,
    preamble: profile.preamble,
    permissions: {
      read: profile.permissions.read ?? ["**/*"],
      write: profile.permissions.write ?? true,
    },
    checks: profile.checks,
  }
}
