# Noxijent Upgrade Tracker

Noxijent is an agentic software-engineering runtime forked from the opencode
harness. It keeps opencode's model/provider flexibility and adds orchestration,
verification, memory, and reliability layers on top, following
`opencode-code-only-roadmap.md`.

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
      (`packages/opencode/src/noxijent/`, 45 unit tests, CLI: `worktree`,
      `checkpoint`, `events`, `done`, `verify`, `risk`)
- [ ] Phase 2 — Intelligence: agent manager, execution graph, repository
      understanding, context engine, project memory, contradiction detector
- [ ] Phase 3 — Reliability: red-team reviewer, issue reproduction, code
      archaeology, task replay, flight recorder, benchmark mode
- [ ] Phase 4 — Advanced orchestration: dynamic agent teams, model routing,
      model tournament, workflow engine, agent profiles, agent hooks

## Notes

- New functionality lives in `packages/opencode/src/noxijent/` with unit tests
  under `packages/opencode/test/noxijent/`. Modules are self-contained (stdlib
  + zod only) so they are fast to test and typecheck, and are wired into the
  CLI additively (new commands only — existing flows are untouched).
- Internal workspace package scope `@opencode-ai/*` is intentionally kept so
  the build graph and lockfile stay intact; user-facing naming moves to
  Noxijent.
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
