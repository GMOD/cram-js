#!/usr/bin/env bash
# Smoke-test the published artifact: npm pack, install into a scratch dir,
# and exercise both ESM and CJS entry points by decoding a real CRAM
# record. The htscodecs-wasm module top-level-imports the inlined wasm
# bundle, so a missing or wrong-module-type bundle fails at import — and
# a broken wasm init fails at decode. We want both classes of break to
# surface here rather than at install time for downstream consumers.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$PKG_DIR"
TARBALL="$(npm pack --silent --pack-destination "$SCRATCH")"

# Small fixture (~3KB) that exercises rANS decompression via the wasm
# bundle. Indexed so we can hit the IndexedCramFile read path.
FIXTURE_DIR="$SCRATCH/data"
mkdir -p "$FIXTURE_DIR"
cp "$PKG_DIR/test/data/auxf#values.tmp.cram" "$FIXTURE_DIR/"
cp "$PKG_DIR/test/data/auxf#values.tmp.cram.crai" "$FIXTURE_DIR/"
cp "$PKG_DIR/test/data/auxf.fa" "$FIXTURE_DIR/"

cd "$SCRATCH"
cat >package.json <<'JSON'
{
  "name": "cram-pack-test",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
npm install --silent --no-audit --no-fund "./$TARBALL" generic-filehandle2 >/dev/null

cat >smoke.mjs <<'JS'
import { CraiIndex, IndexedCramFile } from '@gmod/cram'
import { LocalFile } from 'generic-filehandle2'

const cram = new IndexedCramFile({
  cramFilehandle: new LocalFile('data/auxf#values.tmp.cram'),
  index: new CraiIndex({
    filehandle: new LocalFile('data/auxf#values.tmp.cram.crai'),
  }),
})
const records = await cram.getRecordsForRange(0, 1, 1000)
if (!records.length) throw new Error('esm: expected at least one record')
console.log(`esm decode ok (${records.length} records)`)
JS

cat >smoke.cjs <<'JS'
const { CraiIndex, IndexedCramFile } = require('@gmod/cram')
const { LocalFile } = require('generic-filehandle2')

;(async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: new LocalFile('data/auxf#values.tmp.cram'),
    index: new CraiIndex({
      filehandle: new LocalFile('data/auxf#values.tmp.cram.crai'),
    }),
  })
  const records = await cram.getRecordsForRange(0, 1, 1000)
  if (!records.length) throw new Error('cjs: expected at least one record')
  console.log(`cjs decode ok (${records.length} records)`)
})().catch(e => { console.error(e); process.exit(1) })
JS

node smoke.mjs
node smoke.cjs
