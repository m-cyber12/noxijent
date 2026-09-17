import path from "path"
import { z } from "zod"

/**
 * Repository understanding mode (roadmap §10).
 *
 * Analyzes an unfamiliar repository WITHOUT modifying it and produces a
 * structured map: languages, architecture signals, entrypoints, critical
 * path candidates, import hubs, tests and technical-debt signals. All
 * analysis is static and dependency-free; the report feeds both the CLI
 * (`noxijent understand`) and the context engine (§12).
 */

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  "__pycache__",
])

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".sh": "shell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".scss": "css",
  ".svg": "asset",
  ".png": "asset",
  ".jpg": "asset",
  ".jpeg": "asset",
  ".gif": "asset",
  ".webp": "asset",
  ".lock": "lockfile",
}

const IMPORT_RE =
  /(?:import\s+(?:[^'"]+\s+from\s+)?|import\s*\(|export\s+[^'"]+\s+from\s+|require\s*\()\s*['"]([^'"]+)['"]/g

export const Report = z.object({
  root: z.string(),
  generatedAt: z.string(),
  files: z.object({
    total: z.number(),
    byLanguage: z.record(z.string(), z.number()),
    largest: z.array(z.object({ path: z.string(), bytes: z.number() })),
  }),
  structure: z.object({
    topLevel: z.array(z.string()),
    packages: z.array(z.string()),
  }),
  manifests: z.object({
    name: z.string().optional(),
    packageManager: z.string().optional(),
    packageScripts: z.record(z.string(), z.string()),
    workspaces: z.array(z.string()),
    ciSystems: z.array(z.string()),
    isGit: z.boolean(),
  }),
  tests: z.object({
    files: z.array(z.string()),
    directories: z.array(z.string()),
  }),
  architecture: z.object({
    entrypoints: z.array(z.string()),
    importHubs: z.array(z.object({ path: z.string(), importedBy: z.number() })),
    importEdges: z.number(),
  }),
  debt: z.object({
    todoMarkers: z.array(z.object({ path: z.string(), count: z.number() })),
    longFiles: z.array(z.object({ path: z.string(), lines: z.number() })),
  }),
})
export type Report = z.infer<typeof Report>

// Hidden directories that stay relevant to analysis (CI config lives in
// .github). Everything else starting with a dot is skipped.
const HIDDEN_ALLOW = new Set([".github", ".git"])

async function walk(repo: string, maxFiles: number) {
  const glob = new Bun.Glob("**/*")
  const files: string[] = []
  for await (const entry of glob.scan({ cwd: repo, absolute: false, dot: true, followSymlinks: false })) {
    if (files.length >= maxFiles) break
    if (entry.startsWith(".noxijent/state/")) {
      files.push(entry)
      continue
    }
    if (
      entry.split("/").some((segment) => {
        if (SKIP_DIRS.has(segment)) return true
        return segment.startsWith(".") && !HIDDEN_ALLOW.has(segment)
      })
    )
      continue
    files.push(entry)
  }
  return files
}

/** List repository files (skip directories never relevant to analysis). Relative paths. */
export async function listFiles(repo: string, maxFiles = 25_000) {
  return walk(repo, maxFiles)
}

function languageOf(file: string) {
  if (file.endsWith("bun.lock") || file.endsWith("package-lock.json") || file.endsWith("yarn.lock")) return "lockfile"
  if (path.basename(file) === "Dockerfile" || file.endsWith(".dockerfile")) return "docker"
  return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()] ?? "other"
}

function isCode(file: string) {
  return [
    "typescript",
    "javascript",
    "python",
    "go",
    "rust",
    "java",
    "kotlin",
    "ruby",
    "php",
    "c",
    "cpp",
    "csharp",
  ].includes(languageOf(file))
}

function resolveImport(from: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  return resolved
}

async function candidateExists(repo: string, base: string) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ]
  for (const candidate of candidates) {
    if (await Bun.file(path.join(repo, candidate)).exists()) return candidate
  }
  return undefined
}

export async function analyze(repo: string, opts: { maxFiles?: number } = {}): Promise<Report> {
  const maxFiles = opts.maxFiles ?? 25_000
  const files = await walk(repo, maxFiles)

  const byLanguage: Record<string, number> = {}
  for (const file of files) {
    const language = languageOf(file)
    byLanguage[language] = (byLanguage[language] ?? 0) + 1
  }

  const topLevel = [...new Set(files.map((file) => file.split("/")[0]!))].sort()
  const packages = files
    .filter((file) => file.endsWith("package.json") && !file.includes("node_modules"))
    .map((file) => file)
    .sort()

  const rootManifestText = await Bun.file(path.join(repo, "package.json"))
    .text()
    .catch(() => "")
  const rootManifest = rootManifestText ? (JSON.parse(rootManifestText) as Record<string, unknown>) : undefined
  const packageScripts = (rootManifest?.scripts ?? {}) as Record<string, string>
  const workspacesField = rootManifest?.workspaces as unknown
  const packagesField = (workspacesField as { packages?: unknown } | undefined)?.packages
  const workspaces: string[] = Array.isArray(packagesField)
    ? (packagesField as string[])
    : Array.isArray(workspacesField)
      ? (workspacesField as string[])
      : []

  const ciSystems = [
    files.some((file) => file.startsWith(".github/workflows/")) ? "github-actions" : undefined,
    (await Bun.file(path.join(repo, ".gitlab-ci.yml")).exists()) ? "gitlab-ci" : undefined,
    (await Bun.file(path.join(repo, "Jenkinsfile")).exists()) ? "jenkins" : undefined,
    (await Bun.file(path.join(repo, ".circleci/config.yml")).exists()) ? "circleci" : undefined,
  ].filter((system): system is string => system !== undefined)

  const testFiles = files.filter(
    (file) => /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes("/__tests__/") || /^[^/]*tests?\//.test(file),
  )
  const testDirectories = [...new Set(testFiles.map((file) => path.posix.dirname(file)))].sort()

  const entrypoints = files
    .filter(
      (file) => /(^|\/)(main|index|app|server|cli)\.(ts|tsx|js|jsx|py|go|rs)$/.test(file) && !file.includes("test"),
    )
    .filter((file) => isCode(file))
    .slice(0, 50)

  // Import graph over code files (bounded): edge A -> B when A imports B.
  const codeFiles = files
    .filter(isCode)
    .filter((file) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(file))
    .slice(0, 6000)
  const importedBy = new Map<string, Set<string>>()
  let importEdges = 0
  for (const file of codeFiles) {
    const text = await Bun.file(path.join(repo, file)).text()
    IMPORT_RE.lastIndex = 0
    const specifiers = new Set<string>()
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1]
      if (!spec) continue
      specifiers.add(spec)
    }
    for (const spec of specifiers) {
      const base = resolveImport(file, spec)
      if (!base) continue
      const target = await candidateExists(repo, base)
      if (!target || target === file) continue
      importEdges++
      const set = importedBy.get(target) ?? new Set<string>()
      set.add(file)
      importedBy.set(target, set)
    }
  }

  const importHubs = [...importedBy.entries()]
    .map(([target, sources]) => ({ path: target, importedBy: sources.size }))
    .sort((a, b) => b.importedBy - a.importedBy)
    .slice(0, 15)

  const todoMarkers: Array<{ path: string; count: number }> = []
  const longFiles: Array<{ path: string; lines: number }> = []
  const largestCandidates = files
    .filter((file) => languageOf(file) !== "lockfile" && languageOf(file) !== "asset")
    .slice(0, 8000)
  const sized: Array<{ path: string; bytes: number }> = []
  for (const file of largestCandidates) {
    const text = await Bun.file(path.join(repo, file))
      .text()
      .catch(() => "")
    if (!text) continue
    sized.push({ path: file, bytes: Buffer.byteLength(text) })
    const todos = text.match(/TODO|FIXME|HACK|XXX/g)
    if (todos && todos.length >= 3) todoMarkers.push({ path: file, count: todos.length })
    const lines = text.split("\n").length
    if (lines >= 800) longFiles.push({ path: file, lines })
  }
  const largest = sized.sort((a, b) => b.bytes - a.bytes).slice(0, 10)

  const isGit = await Bun.file(path.join(repo, ".git/HEAD")).exists()

  return Report.parse({
    root: repo,
    generatedAt: new Date().toISOString(),
    files: { total: files.length, byLanguage, largest },
    structure: { topLevel, packages },
    manifests: {
      name: typeof rootManifest?.name === "string" ? rootManifest.name : undefined,
      packageManager: typeof rootManifest?.packageManager === "string" ? rootManifest.packageManager : undefined,
      packageScripts,
      workspaces,
      ciSystems,
      isGit,
    },
    tests: { files: testFiles.slice(0, 200), directories: testDirectories.slice(0, 50) },
    architecture: { entrypoints, importHubs, importEdges },
    debt: {
      todoMarkers: todoMarkers.sort((a, b) => b.count - a.count).slice(0, 10),
      longFiles: longFiles.sort((a, b) => b.lines - a.lines).slice(0, 10),
    },
  })
}

/** Human-readable rendering, following the roadmap's output layout. */
export function render(report: Report): string {
  const section = (title: string, items: string[]) => [title, ...items.map((item) => `  ${item}`)].join("\n")
  const top = (record: Record<string, number>, n: number) =>
    Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => `${key} (${count})`)

  return [
    `Repository: ${report.root}`,
    section("Languages", top(report.files.byLanguage, 8)),
    section("Structure", [
      `top-level: ${report.structure.topLevel.slice(0, 15).join(", ")}`,
      `packages: ${report.structure.packages.length === 0 ? "none" : `${report.structure.packages.length} manifests`}`,
      `ci: ${report.manifests.ciSystems.join(", ") || "none detected"}`,
      `scripts: ${Object.keys(report.manifests.packageScripts).slice(0, 12).join(", ") || "none"}`,
    ]),
    section("Architecture", [
      ...report.architecture.entrypoints.slice(0, 8).map((file) => `entrypoint: ${file}`),
      ...report.architecture.importHubs.slice(0, 8).map((hub) => `hub: ${hub.path} (imported by ${hub.importedBy})`),
    ]),
    section("Critical paths", [
      ...report.structure.topLevel
        .filter((dir) => /auth|pay|bill|deploy|server|api|core|security/i.test(dir))
        .map((dir) => dir),
      ...(report.structure.topLevel.some((dir) => /auth|pay|bill|deploy|server|api|core|security/i.test(dir))
        ? []
        : ["none detected by name heuristics"]),
    ]),
    section("Tests", [
      `${report.tests.files.length} test file(s)`,
      ...report.tests.directories.slice(0, 6).map((dir) => `dir: ${dir}`),
    ]),
    section("Technical debt", [
      ...report.debt.todoMarkers.map((item) => `todo-markers(${item.count}): ${item.path}`),
      ...report.debt.longFiles.map((item) => `long-file(${item.lines} lines): ${item.path}`),
      ...(report.debt.todoMarkers.length === 0 && report.debt.longFiles.length === 0 ? ["no obvious signals"] : []),
    ]),
  ].join("\n\n")
}
