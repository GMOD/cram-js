#!/usr/bin/env bash
# Smoke-test the published artifact: npm pack, install into a scratch dir,
# and import through both ESM and CJS entry points. The htscodecs-wasm
# module top-level-imports the wasm bundle, so a missing or
# wrong-module-type bundle fails at import — that's what we're guarding
# against.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$PKG_DIR"
TARBALL="$(npm pack --silent --pack-destination "$SCRATCH")"

cd "$SCRATCH"
cat >package.json <<'JSON'
{
  "name": "cram-pack-test",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
npm install --silent --no-audit --no-fund "./$TARBALL" >/dev/null

cat >smoke.mjs <<'JS'
import { CramFile, CraiIndex, IndexedCramFile, CramRecord } from '@gmod/cram'
for (const [name, fn] of Object.entries({ CramFile, CraiIndex, IndexedCramFile, CramRecord })) {
  if (typeof fn !== 'function') throw new Error(`${name} missing from ESM entry`)
}
console.log('esm import ok')
JS

cat >smoke.cjs <<'JS'
const { CramFile, CraiIndex, IndexedCramFile, CramRecord } = require('@gmod/cram')
for (const [name, fn] of Object.entries({ CramFile, CraiIndex, IndexedCramFile, CramRecord })) {
  if (typeof fn !== 'function') throw new Error(`${name} missing from CJS entry`)
}
console.log('cjs import ok')
JS

node smoke.mjs
node smoke.cjs
