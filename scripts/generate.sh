#!/usr/bin/env bash
#
# Regenerates src/generated/** from the COMMITTED schemas/openapi.json.
# It never touches the network: `pnpm run schema:update` is the only thing
# that refreshes the vendored document.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

echo "Validating the vendored OpenAPI document..."
pnpm exec tsx "${SCRIPT_DIR}/validate-openapi.ts" schemas/openapi.json

echo
echo "Generating the TypeScript client with OpenAPI-ts..."
pnpm exec openapi-ts

echo
echo "Formatting generated output..."
pnpm exec prettier --write src/generated --log-level warn

echo
echo "Done."
