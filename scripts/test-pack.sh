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

# What the tarball CONTAINS, before anything is installed from it. `pnpm test`
# runs against src/, so nothing else in the repo can see the package's shape,
# and 13.1.0 shipped ~1.9 MB of build droppings on exactly that blind spot.
# Both checks below are for defects that shipped, not hypotheticals.
check_tarball_contents() {
  local listing
  listing="$(tar tzf "$SCRATCH/$TARBALL")"

  # (1) webpack's worker intermediate. It used to be written into src/wasm/,
  # where `allowJs` made it a tsc input, so it was compiled into esm/ and dist/
  # and published three times with two sourcemaps. Nothing imports it. It now
  # goes to a gitignored build/ — if one reappears here, that broke.
  local intermediates
  intermediates="$(grep -E '\-inlined\.js(\.map)?$' <<<"$listing" || true)"
  if [ -n "$intermediates" ]; then
    echo "error: build intermediates in the tarball; webpack should write these to build/, not src/wasm/:" >&2
    echo "$intermediates" >&2
    return 1
  fi

  # (2) a declaration file that is really a bundle. tsc emits a .d.ts for the
  # inlined worker under allowJs, and left to infer the type of a 400,000-char
  # string it writes the whole bundle out again as a literal type — 440 KB, in
  # both output dirs, for every consumer's tsc to parse. inline-worker.sh
  # annotates the const to keep it at ~87 bytes. 32 KB is far above any
  # hand-written declaration here and far below a regression.
  local big
  big="$(tar tzvf "$SCRATCH/$TARBALL" |
    awk '$NF ~ /\.d\.ts$/ && $3 > 32768 { print $3, $NF }')"
  if [ -n "$big" ]; then
    echo "error: oversized .d.ts in the tarball — a literal type of a bundle, not a declaration:" >&2
    echo "$big" >&2
    return 1
  fi
}
check_tarball_contents

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
import {
  CIGAR_INS,
  CIGAR_MATCH,
  CraiIndex,
  IndexedCramFile,
  RF_INSERTION,
  RF_POSITIONAL,
  RF_QUAL,
  arenaFromReadFeatures,
} from '@gmod/cram'
import { LocalFile } from 'generic-filehandle2'

// The columnar read-feature API lives in its own module, and this fixture's two
// records are plain 10M matches carrying no read features — so a build that
// failed to emit that module would still decode fine here. Exercise it directly.
const arena = arenaFromReadFeatures([
  { code: 'I', data: 'AC', pos: 5, refPos: 5 },
])
if (
  arena.length !== 1 ||
  arena.codes[0] !== RF_INSERTION ||
  arena.payloadStringAt(0) !== 'AC' ||
  !RF_POSITIONAL[RF_INSERTION] ||
  RF_POSITIONAL[RF_QUAL]
) {
  throw new Error('esm: read-feature arena module is broken')
}

const cram = new IndexedCramFile({
  cramFilehandle: new LocalFile('data/auxf#values.tmp.cram'),
  index: new CraiIndex({
    filehandle: new LocalFile('data/auxf#values.tmp.cram.crai'),
  }),
})
const records = await cram.getRecordsForRange(0, 1, 1000)
if (!records.length) throw new Error('esm: expected at least one record')

// The CIGAR walk and the clip getter live in their own module too, so a build
// that failed to emit it would import fine here but blow up on use.
const ops = []
records[0].forEachCigarOp((op, length) => ops.push([op, length]))
if (
  !ops.length ||
  ops.some(([op]) => op !== CIGAR_MATCH && op !== CIGAR_INS) ||
  records[0].getCigarString() === '' ||
  typeof records[0].getLeadingClipLength() !== 'number'
) {
  throw new Error('esm: cigar module is broken')
}
console.log(
  `esm decode ok (${records.length} records, arena + cigar modules ok)`,
)
JS

cat >smoke.cjs <<'JS'
const {
  CIGAR_INS,
  CIGAR_MATCH,
  CraiIndex,
  IndexedCramFile,
  RF_INSERTION,
  RF_POSITIONAL,
  RF_QUAL,
  arenaFromReadFeatures,
} = require('@gmod/cram')
const { LocalFile } = require('generic-filehandle2')

const arena = arenaFromReadFeatures([
  { code: 'I', data: 'AC', pos: 5, refPos: 5 },
])
if (
  arena.length !== 1 ||
  arena.codes[0] !== RF_INSERTION ||
  arena.payloadStringAt(0) !== 'AC' ||
  !RF_POSITIONAL[RF_INSERTION] ||
  RF_POSITIONAL[RF_QUAL]
) {
  throw new Error('cjs: read-feature arena module is broken')
}

;(async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: new LocalFile('data/auxf#values.tmp.cram'),
    index: new CraiIndex({
      filehandle: new LocalFile('data/auxf#values.tmp.cram.crai'),
    }),
  })
  const records = await cram.getRecordsForRange(0, 1, 1000)
  if (!records.length) throw new Error('cjs: expected at least one record')

  const ops = []
  records[0].forEachCigarOp((op, length) => ops.push([op, length]))
  if (
    !ops.length ||
    ops.some(([op]) => op !== CIGAR_MATCH && op !== CIGAR_INS) ||
    records[0].getCigarString() === '' ||
    typeof records[0].getLeadingClipLength() !== 'number'
  ) {
    throw new Error('cjs: cigar module is broken')
  }
  console.log(
    `cjs decode ok (${records.length} records, arena + cigar modules ok)`,
  )
})().catch(e => { console.error(e); process.exit(1) })
JS

node smoke.mjs
node smoke.cjs
