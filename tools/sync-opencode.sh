#!/usr/bin/env bash
#
# sync-opencode.sh
# ---------------------------------------------------------------
# Copies ONLY the agent + harness parts of opencode
# (https://github.com/anomalyco/opencode) into this repository,
# keeping the original directory layout.
#
# Usage:
#   tools/sync-opencode.sh                  # clone upstream at the pinned ref into a temp dir
#   tools/sync-opencode.sh --source DIR     # copy from an existing local checkout instead
#
# Everything that is not agent/harness related (web UI, desktop app,
# console, docs site, stats, TUI front-end, SDKs, tests, translations,
# ...) is deliberately NOT copied. See README.md for the full list.
#
set -euo pipefail

UPSTREAM_REPO="https://github.com/anomalyco/opencode.git"
UPSTREAM_REF="5a8335857b0ebec44ef6aa1d52b339cf25c329ca" # dev @ 2026-09-17
UPSTREAM_REF_LABEL="dev @ 5a83358 (2026-09-17)"

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE=""
TMP_CLONE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --help|-h) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SOURCE" ]; then
  TMP_CLONE="$(mktemp -d)"
  echo "==> cloning $UPSTREAM_REPO ($UPSTREAM_REF)"
  git clone --filter=blob:none --no-checkout "$UPSTREAM_REPO" "$TMP_CLONE/opencode" >/dev/null 2>&1
  git -C "$TMP_CLONE/opencode" checkout --quiet "$UPSTREAM_REF"
  SOURCE="$TMP_CLONE/opencode"
  cleanup() { rm -rf "$TMP_CLONE"; }
  trap cleanup EXIT
fi

[ -d "$SOURCE/packages" ] || { echo "error: $SOURCE does not look like an opencode checkout" >&2; exit 1; }

echo "==> source: $SOURCE"
echo "==> dest:   $DEST"

# ---------------------------------------------------------------------------
# 1) pruning rules
#    - no tests / fixtures / e2e / recordings
#    - no build + tooling noise
# ---------------------------------------------------------------------------
PRUNE=(
  --exclude='node_modules'
  --exclude='.turbo'
  --exclude='dist'
  --exclude='build'
  --exclude='coverage'
  --exclude='test'
  --exclude='tests'
  --exclude='e2e'
  --exclude='__snapshots__'
  --exclude='*.test.ts'
  --exclude='*.test.tsx'
  --exclude='*.test.js'
  --exclude='*.spec.ts'
  --exclude='*.spec.tsx'
  --exclude='*.snap'
)

# ---------------------------------------------------------------------------
# 2) repository level agent/harness docs + opencode's own agent config
# ---------------------------------------------------------------------------
ROOT_PATHS=(
  LICENSE          # MIT license of the upstream project (required for reuse)
  AGENTS.md        # repo-wide agent/contributor instructions
  CONTEXT.md       # harness design doc: session runtime / system context
  .opencode        # agents, commands, skills, tools, glossary, plugins, config
)

# ---------------------------------------------------------------------------
# 3) whole packages that the agent/harness stack is built from
# ---------------------------------------------------------------------------
FULL_PACKAGES=(
  packages/core                  # harness engine: session runner, tools, permissions, context
  packages/llm                   # provider-agnostic LLM client used by the harness
  packages/schema                # message / tool / agent / permission contracts
  packages/plugin                # agent plugin + hook API
  packages/protocol              # HTTP API contracts of the harness server
  packages/server                # harness HTTP handlers (session, agent, message, permission, ...)
  packages/effect-drizzle-sqlite # sqlite/drizzle adapter used by the harness database layer
)

FULL_PACKAGE_FILES=(
  package.json
  tsconfig.json
  bunfig.toml
  drizzle.config.ts
)

# ---------------------------------------------------------------------------
# 4) curated selection inside packages/opencode (the coding agent itself)
#    agent runtime, tools, providers, prompts, permissions, plugins, MCP,
#    ACP, CLI surface + harness server. UI/cloud/editor glue is left out.
# ---------------------------------------------------------------------------
OPENCODE_SRC_DIRS=(
  acp agent auth background bus command config effect env format git id image
  lsp mcp patch permission plugin project provider question server session
  skill snapshot storage sync tool util worktree cli
)
OPENCODE_SRC_FILES=(
  index.ts node.ts event-manifest.ts event-v2-bridge.ts temporary.ts
  audio.d.ts markdown.d.ts sql.d.ts
)

# not agent/harness related: billing, usage stats, web-UI launcher,
# self-update/uninstall and the interactive TUI front-end glue
OPENCODE_EXCLUDE=(
  --exclude='packages/opencode/src/cli/tui'
  --exclude='packages/opencode/src/cli/upgrade.ts'
  --exclude='packages/opencode/src/cli/cmd/account.ts'
  --exclude='packages/opencode/src/cli/cmd/stats.ts'
  --exclude='packages/opencode/src/cli/cmd/web.ts'
  --exclude='packages/opencode/src/cli/cmd/uninstall.ts'
  --exclude='packages/opencode/src/cli/cmd/upgrade.ts'
  --exclude='packages/opencode/README.md'
  --exclude='packages/opencode/Dockerfile'
  --exclude='packages/opencode/parsers-config.ts'
)

# paths that a previous sync may have left behind; removed before copying so
# that re-running the sync always produces the same tree
PURGE=(
  packages/opencode/src/control-plane
  packages/opencode/src/account
  packages/opencode/src/share
  packages/opencode/src/installation
  packages/opencode/src/ide
  packages/opencode/src/cli/tui
  packages/opencode/src/cli/upgrade.ts
  packages/opencode/src/cli/cmd/account.ts
  packages/opencode/src/cli/cmd/stats.ts
  packages/opencode/src/cli/cmd/web.ts
  packages/opencode/src/cli/cmd/uninstall.ts
  packages/opencode/src/cli/cmd/upgrade.ts
  packages/opencode/README.md
  packages/opencode/Dockerfile
  packages/opencode/parsers-config.ts
)

echo "==> pruning non agent/harness leftovers"
for p in "${PURGE[@]}"; do rm -rf "${DEST:?}/$p"; done

echo "==> copying agent/harness files"
(
  cd "$SOURCE"
  {
    printf '%s\n' "${ROOT_PATHS[@]}"
    for pkg in "${FULL_PACKAGES[@]}"; do
      for f in "${FULL_PACKAGE_FILES[@]}"; do [ -f "$pkg/$f" ] && printf '%s\n' "$pkg/$f"; done
      printf '%s\n' "$pkg/src"
    done
    # support files of the opencode package itself
    for f in packages/opencode/AGENTS.md packages/opencode/package.json packages/opencode/tsconfig.json \
             packages/opencode/bunfig.toml; do [ -f "$f" ] && printf '%s\n' "$f"; done
    for d in packages/opencode/bin packages/opencode/specs packages/opencode/migration; do
      [ -d "$d" ] && printf '%s\n' "$d"
    done
    for d in "${OPENCODE_SRC_DIRS[@]}"; do printf '%s\n' "packages/opencode/src/$d"; done
    for f in "${OPENCODE_SRC_FILES[@]}"; do [ -f "packages/opencode/src/$f" ] && printf '%s\n' "packages/opencode/src/$f"; done
  } | tar -cf - "${PRUNE[@]}" "${OPENCODE_EXCLUDE[@]}" -T - \
    | tar -xf - -C "$DEST"
)

cat > "$DEST/tools/opencode-upstream.txt" <<EOF
repo   $UPSTREAM_REPO
ref    $UPSTREAM_REF
label  $UPSTREAM_REF_LABEL
synced $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "==> done"
find "$DEST" -path "$DEST/.git" -prune -o -type f -print | wc -l | xargs echo "files:"
du -sh --exclude=.git "$DEST" | awk '{print "size:  "$1}'
