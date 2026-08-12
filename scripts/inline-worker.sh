#!/bin/bash
set -euo pipefail

# Wrap the bundled worker as a string module, so the pool can launch it from a
# Blob URL without the consumer configuring anything.
#
# SYNC: @gmod/bgzf-filehandle scripts/inline-worker.sh. Unlike that one, this is
# wired into `pnpm build` — see build:worker — because `preversion` runs the
# build, and a generated artifact no script produces is one `npm version` can
# commit unreviewed part-way through a release.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_FILE="$ROOT_DIR/build/worker/cram-worker-inlined.js"
OUTPUT_FILE="$ROOT_DIR/src/wasm/cram-worker-source.js"

if [ ! -f "$WORKER_FILE" ]; then
  echo "error: $WORKER_FILE not found; run webpack --config webpack.worker.config.js first" >&2
  exit 1
fi

# The `@type {string}` is load-bearing, not decoration. tsc reads this file
# under `allowJs` and emits a .d.ts for it over the top of any hand-written one;
# left to infer, it writes out the whole bundle a second time as a string
# literal type — a 440 KB .d.ts that shipped in both esm/ and dist/ and that
# every consumer's tsc then had to parse. Annotated, the declaration is one line.
{
  echo "// Auto-generated - do not edit. Run pnpm build:worker to regenerate."
  echo "// eslint-disable-next-line"
  printf '/** @type {string} */\nconst workerSource = '
  node -e '
    const fs = require("fs")
    process.stdout.write(JSON.stringify(fs.readFileSync(process.argv[1], "utf8")))
  ' "$WORKER_FILE"
  echo ""
  echo "export default workerSource"
} > "$OUTPUT_FILE"

echo "worker inlined into $OUTPUT_FILE ($(wc -c <"$OUTPUT_FILE") bytes)"
