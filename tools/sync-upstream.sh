#!/usr/bin/env bash
#
# sync-upstream.sh — refresh this repository from the upstream noxijent repo.
#
# This repository is a *complete* copy of https://github.com/anomalyco/noxijent
# with exactly two kinds of files removed:
#
#   1. tests            (test/, tests/, e2e/, __tests__/, __snapshots__/,
#                        test-browser/, test-*/, *.test.*, *.spec.*, *.snap)
#   2. extra READMEs    (README.<lang>.md and every nested README.md —
#                        only the root README.md is kept)
#
# Everything else — sources, prompts, scripts, configs, lockfile, assets and
# the MIT LICENSE — is copied untouched, so `bun install` and `bun dev`
# behave exactly like upstream.
#
# CI workflows are the one exception: GitHub rejects pushes that add files
# under .github/workflows/ when the pushing app lacks the `workflows`
# permission, so they are stored verbatim in tools/upstream-workflows/ and
# can be restored with:
#   mkdir -p .github/workflows && cp tools/upstream-workflows/*.yml .github/workflows/
#
# Usage:
#   tools/sync-upstream.sh                # clone the pinned upstream commit
#   tools/sync-upstream.sh --ref dev      # ... or track a branch/commit
#   tools/sync-upstream.sh --source DIR   # copy from an existing checkout
#   tools/sync-upstream.sh --dest DIR     # write somewhere else (default: this repo)
#
set -euo pipefail

UPSTREAM_REPO="https://github.com/anomalyco/noxijent.git"
UPSTREAM_REF="5a8335857b0ebec44ef6aa1d52b339cf25c329ca" # dev @ 2026-09-17
REF_EXPLICIT=0

SOURCE=""; TMP=""; DEST_OVERRIDE=""

DEFAULT_DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$DEFAULT_DEST"

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --dest) DEST_OVERRIDE="$2"; shift 2 ;;
    --ref) UPSTREAM_REF="$2"; REF_EXPLICIT=1; shift 2 ;;
    --help|-h) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[ -n "$DEST_OVERRIDE" ] && DEST="$DEST_OVERRIDE"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [ -z "$SOURCE" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "==> cloning $UPSTREAM_REPO ($UPSTREAM_REF)"
  git clone --filter=blob:none "$UPSTREAM_REPO" "$TMP/noxijent" >/dev/null 2>&1
  [ "$REF_EXPLICIT" = 1 ] && git -C "$TMP/noxijent" checkout --quiet "$UPSTREAM_REF" \
                         || git -C "$TMP/noxijent" checkout --quiet "$UPSTREAM_REF"
  SOURCE="$TMP/noxijent"
fi

[ -d "$SOURCE/packages" ] || { echo "error: $SOURCE is not an noxijent checkout" >&2; exit 1; }
echo "==> source: $SOURCE"
echo "==> dest:   $DEST"

# 1) copy everything except .git and tests
tar -C "$SOURCE" -cf - \
  --exclude='.git' \
  --exclude='test' \
  --exclude='tests' \
  --exclude='e2e' \
  --exclude='__tests__' \
  --exclude='__snapshots__' \
  --exclude='test-browser' \
  --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='*.test.js' \
  --exclude='*.test.jsx' --exclude='*.test.mts' --exclude='*.test.cts' \
  --exclude='*.spec.ts' --exclude='*.spec.tsx' --exclude='*.spec.js' \
  --exclude='*.snap' \
  . | tar -xf - -C "$DEST"

# 2) keep only the main README.md, then drop directories left empty
find "$DEST" -path "$DEST/.git" -prune -o -type f -iname 'README*.md' \
  ! -path "$DEST/README.md" -exec rm -f {} +
for _ in 1 2 3; do
  find "$DEST" -path "$DEST/.git" -prune -o -type d -empty -exec rmdir {} + 2>/dev/null || true
done

# 2b) park the CI workflows outside .github/workflows (see note at the top)
mkdir -p "$DEST/tools/upstream-workflows"
cp -f "$DEST"/.github/workflows/*.yml "$DEST/tools/upstream-workflows/" 2>/dev/null || true
rm -f "$DEST"/.github/workflows/*.yml
rmdir "$DEST/.github/workflows" 2>/dev/null || true

# 3) record provenance
REF_SHA="$(git -C "$SOURCE" rev-parse HEAD 2>/dev/null || echo unknown)"
cat > "$DEST/tools/noxijent-upstream.txt" <<EOF
repo   $UPSTREAM_REPO
ref    $REF_SHA
synced $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "==> done: $(find "$DEST" -path "$DEST/.git" -prune -o -type f -print | wc -l) files"
