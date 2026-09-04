#!/usr/bin/env bash
#
# Regenerates the client from the committed schema and fails when the result
# differs from the committed src/generated. Keeps the vendored spec and the
# checked-in output honest in CI.
#
# The generator writes straight into src/generated — the output path lives in
# openapi-ts.config.ts — so this script copies the committed tree aside first
# and an EXIT trap puts it back however the run ends: success, failure, or an
# interrupt. The worktree is never left holding a half-regenerated tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

if [ ! -d src/generated ]; then
  echo "src/generated is missing. Run 'pnpm run generate' first." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cp -R src/generated "${WORK_DIR}/committed"

# Installed only after the copy exists, so it can never restore from nothing.
restore_committed_output() {
  rm -rf src/generated
  cp -R "${WORK_DIR}/committed" src/generated
  rm -rf "${WORK_DIR}"
}
trap restore_committed_output EXIT

echo "Regenerating the client from schemas/openapi.json..."
pnpm exec openapi-ts >/dev/null
pnpm exec prettier --write src/generated --log-level warn >/dev/null

if diff -ru "${WORK_DIR}/committed" src/generated; then
  echo "generate:check: src/generated matches schemas/openapi.json."
else
  echo >&2
  echo "generate:check: src/generated is stale. Run 'pnpm run generate' and commit the result." >&2
  exit 1
fi
