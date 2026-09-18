# Noxijent Upgrade Tracker

Noxijent is an agentic software-engineering runtime built on the Noxijent
harness. It keeps the unbranded terminal harness's model/provider flexibility and adds orchestration,
verification, memory, and reliability layers on top, following
`noxijent-code-only-roadmap.md`.

Central design principle:

> Noxijent should not merely generate code. It should execute, verify, explain,
> and recover from software-engineering tasks.

## Work plan (phase by phase, CI-gated)

Every phase lands on branch `arena/01a0b024-noxijent` as its own commit set and
must pass GitHub Actions (`ci` workflow: typecheck + unit tests + lint) before
the next phase starts.

- [x] Phase 0 — Rebrand to Noxijent (name, logo, theme, README) + CI drafted
      (`tools/noxijent-workflows/ci.yml`; activation pending GitHub `workflows`
      permission on the pushing app — see "GitHub Actions gate" below)
- [x] Phase 1 — Foundation: agent worktrees, checkpoints, structured events,
      Definition of Done, test/fix/verify loop, risk-based action policies
      (`packages/noxijent/src/noxijent/`, 45 unit tests, CLI: `worktree`,
      `checkpoint`, `events`, `done`, `verify`, `risk`)
- [x] Phase 2 — Intelligence: agent manager + execution graph, repository
      understanding, context engine, project memory, contradiction detector
      (`packages/noxijent/src/noxijent/`, 91 unit tests across 13 modules,
      CLI: `understand`, `context`, `plan`, `memory`, `contradictions`)
- [x] Phase 3 — Reliability: red-team reviewer, issue reproduction, code
      archaeology, task replay, flight recorder, benchmark mode (139 unit
      tests across 18 files; CLI: `flight`, `replay`, `archaeology`,
      `redteam`, `repro`, `benchmark`)
- [x] Phase 4 — Advanced orchestration: dynamic agent teams with failure
      escalation, local model routing, model tournament, workflow engine,
      agent profiles, agent hooks (183 unit tests across 24 files; CLI:
      `profile`, `hooks`, `route`, `tournament`, `workflow`; dynamic teams
      ship as the runtime `teams` module used by the manager)
- [x] Repo-wide identity purge: every `opencode` token (all casings:
      opencode/Opencode/OpenCode/openCode/OPENCODE) mechanically swapped to
      Noxijent across all 2,200+ text files; package renamed
      `packages/opencode` → `packages/noxijent` (package name `noxijent`,
      binary `noxijent`); all `opencode` paths renamed (`.noxijent/`,
      `nix/noxijent.nix`, brand assets, vendor archives); lockfiles made
      token-consistent. Kept as-is per scope: LICENSE attribution text and
      third-party published packages (`opencode-agent`,
      `opencode-gitlab-auth`/`@gitlab/opencode-gitlab-auth`,
      `opencode-poe-auth`); binary brand archives renamed but not re-authored,
      and the historical upstream `opencode` color theme was dropped from the
      TUI theme set (the `noxijent` theme is the brand theme).

## Notes

- New functionality lives in `packages/noxijent/src/noxijent/` with unit tests
  under `packages/noxijent/test/noxijent/`. Modules are self-contained (stdlib
  + zod only) so they are fast to test and typecheck, and are wired into the
  CLI additively (new commands only — existing flows are untouched).
- Project memory lives in `.noxijent/memory.json` (sorted by key, committable).
  Context snapshots and execution graphs persist under
  `.noxijent/state/context/` and `.noxijent/state/graphs/` — runtime state
  stays inside the self-ignored `state/` tree.
- Reliability state: flight timelines and replay records under
  `.noxijent/state/flight/` and `.noxijent/state/replay/`; benchmark runs in
  `.noxijent/state/benchmark/` (`latest.json` + timestamped history) with
  scenarios defined in the committable `.noxijent/evals/<name>/scenario.json`.
  Repro scaffolds land in `.noxijent/state/repro/` for promotion into the
  test tree once they reproduce the bug.
- Orchestration contracts (all committable JSON): `.noxijent/profiles/`
  (agent definitions), `.noxijent/hooks.json` (lifecycle hook commands with
  block/warn policies), `.noxijent/models.json` (model catalog overrides),
  `.noxijent/workflows/<name>.json` (step DAGs executed by the workflow
  engine). Runtime artifacts (tournaments, workflow runs, graphs) stay in
  `.noxijent/state/`.
- Internal workspace scope is `@noxijent-ai/*` everywhere (packages,
  binary, config dirs, lockfile) — nothing user-facing answers to the old name.
- Runtime state lives in `.noxijent/state/` (self-ignored via a nested
  `.gitignore`); repository contracts (definition of done, risk policies)
  live in `.noxijent/*.jsonc` and are meant to be committed.

## GitHub Actions gate

The CI workflow is ready at `tools/noxijent-workflows/ci.yml` (typecheck +
unit tests + scoped oxlint, GitHub-hosted `ubuntu-latest` runners). The
GitHub App used to push this branch currently lacks the `workflows`
permission, so the file cannot land in `.github/workflows/` from the agent
session. Reconnect GitHub in Arena (or copy the file into
`.github/workflows/` with a token that has the `workflow` scope) to activate
per-phase CI runs.
