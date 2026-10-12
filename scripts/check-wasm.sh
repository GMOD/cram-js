#!/usr/bin/env bash
# Run after `pnpm build`: fails when a rebuilt wasm or worker bundle differs
# from the committed one, or the build wrote a file git doesn't track.
set -euo pipefail

cd "$(dirname "$0")/.."
DRIFT="$(git status --porcelain -- src/wasm htscodecs-wasm/htscodecs.esm.js)"
if [ -n "$DRIFT" ]; then
  echo "$DRIFT" >&2
  echo "The committed wasm bundles do not match a fresh build." >&2
  echo "Run pnpm build:wasm and pnpm build:worker, then commit the result." >&2
  exit 1
fi
echo "Committed wasm bundles match a fresh build"
