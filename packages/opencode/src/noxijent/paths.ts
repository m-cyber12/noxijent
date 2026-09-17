import { mkdir } from "node:fs/promises"
import path from "path"

/**
 * Noxijent keeps project-level state inside `.noxijent/` at the repository
 * root. Subdirectory `./state/` holds runtime data that must never be
 * committed (events, flight records, agent worktrees, ...). A `.gitignore`
 * inside `state/` marks it ignored without touching the user's own
 * `.gitignore` file.
 */
export const DIR = ".noxijent"
export const STATE = "state"

export function root(repo: string) {
  return path.join(repo, DIR)
}

export function stateDir(repo: string, ...segments: string[]) {
  return path.join(repo, DIR, STATE, ...segments)
}

export function stateGitignorePath(repo: string) {
  return stateDir(repo, ".gitignore")
}

export async function ensureState(repo: string, ...segments: string[]) {
  const dir = stateDir(repo, ...segments)
  await mkdir(dir, { recursive: true })
  const marker = Bun.file(stateGitignorePath(repo))
  if (!(await marker.exists())) await Bun.write(marker, "*\n")
  return dir
}

/** Slugify an agent/task name so it is safe for branch names and paths. */
export function slug(input: string) {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (cleaned) return cleaned
  throw new Error(`name ${JSON.stringify(input)} does not contain any usable characters`)
}
