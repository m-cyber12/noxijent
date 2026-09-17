<p align="center">
  <img src="packages/console/app/src/asset/logo-ornate-dark.svg" alt="Noxijent logo" width="320">
</p>

<h1 align="center">Noxijent</h1>

<p align="center">
  <strong>An open, model-agnostic runtime for software-engineering agents.</strong>
</p>

<p align="center">
  Noxijent does not merely generate code — it executes, verifies, explains, and
  recovers from software-engineering tasks.
</p>

---

Noxijent is a fork of the [opencode](https://github.com/sst/opencode) harness
(snapshot of `anomalyco/opencode@dev`, commit
`5a8335857b0ebec44ef6aa1d52b339cf25c329ca`), rebranded and extended with an
orchestration-first feature set implemented phase by phase from
[`opencode-code-only-roadmap.md`](./opencode-code-only-roadmap.md):

```text
Task
  ↓
Planning
  ↓
Execution Graph
  ↓
Parallel Agents
  ↓
Isolated Worktrees
  ↓
Implementation
  ↓
Testing
  ↓
Adversarial Review
  ↓
Integration
  ↓
Checkpoint
  ↓
Verification
  ↓
Completion
```

Progress per phase is tracked in [`NOXIJENT.md`](./NOXIJENT.md).

## Highlights

- **Everything opencode already does**: TUI coding agent, multi-provider model
  support, LSP, MCP, sessions, share, and more.
- **Foundation layer**: per-agent git worktrees, checkpoints/time-machine,
  structured agent events, definition-of-done as code, automatic
  test/fix/verify loops, and risk-based action policies.
- **Intelligence layer**: agent manager, execution graph ("agent compiler"),
  repository understanding mode, context engine, project memory with
  evidence/confidence, and a contradiction detector.
- **Reliability layer**: red-team reviewer, automatic issue reproduction, code
  archaeology, task replay, agent flight recorder, benchmark mode.
- **Advanced orchestration**: dynamic agent teams, local model routing, model
  tournaments, workflow files, agent profiles, lifecycle hooks.
- **New default theme**: `noxijent` (midnight violet × agent teal), available
  alongside the classic themes.

## Run from source

```bash
git clone https://github.com/m-cyber12/noxijent.git
cd noxijent

bun --version        # bun 1.3.14 (pinned in package.json)
bun install

bun dev              # start the Noxijent agent (TUI)
bun dev:web          # web app
bun run typecheck    # typecheck the monorepo
bun run lint         # lint
```

If you don't have bun: `curl -fsSL https://bun.sh/install | bash`.

## Testing

New Noxijent functionality ships with unit tests under
`packages/opencode/test/`. Run them with:

```bash
bun --cwd packages/opencode test
```

Every phase is gated by GitHub Actions (`.github/workflows/ci.yml`):
typecheck, unit tests, and scoped lint must pass before the next phase begins.

## Provenance

- Upstream project: `anomalyco/opencode` (`dev` branch), MIT license (see
  [`LICENSE`](./LICENSE), unchanged).
- This snapshot intentionally shipped without upstream tests; Noxijent adds its
  own test suite incrementally.
- Upstream CI files are preserved in `tools/upstream-workflows/`;
  Noxijent maintains its own workflow set adapted to this repository.
- To re-sync with upstream: `tools/sync-upstream.sh` (pinned commit in
  `tools/opencode-upstream.txt`).
