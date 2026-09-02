// Retained-heap measurement for decoded records, per the method note in TODO.md:
// one fresh process per variant, forced GC either side, and no warm-up decode
// (a discarded `await` at module top level stays reachable, lands in the
// baseline, and silently collapses the measured delta to ~0).
//
//   node --expose-gc --experimental-strip-types scripts/measure-heap.ts <case> [--walk]
//
// <case> is a substring of one of the names below. --walk additionally runs the
// two jbrowse-style walks over every record, so the number reflects what a real
// consumer retains rather than the arena alone.
import { LocalFile } from 'generic-filehandle2'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

import type CramRecord from '../src/cramFile/record.ts'

const cases = [
  { name: 'ONT', cramPath: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram' },
  { name: 'SRR396636', cramPath: 'test/data/SRR396636.sorted.clip.cram' },
  { name: 'SRR396637', cramPath: 'test/data/SRR396637.sorted.clip.cram' },
]

const which = process.argv[2] ?? 'ONT'
const walk = process.argv.includes('--walk')
const c = cases.find(x => x.name.includes(which))
if (!c) {
  throw new Error(`unknown case ${which}`)
}

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start)

// heapUsed alone undercounts a columnar layout badly: V8 allocates ArrayBuffer
// backing stores outside the JS heap, so every typed-array column shows up in
// `arrayBuffers` instead. Report both, and the sum as the number that matters.
function usage() {
  global.gc!()
  global.gc!()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return { heapUsed, arrayBuffers }
}

const before = usage()

const cram = new IndexedCramFile({
  cramFilehandle: new LocalFile(c.cramPath),
  index: new CraiIndex({ filehandle: new LocalFile(`${c.cramPath}.crai`) }),
  fetchReferenceSequence: seqFetch,
  checkSequenceMD5: false,
})
const t0 = performance.now()
const records: CramRecord[] = await cram.getRecordsForRange(0, 0, 100_000_000)
const decodeMs = performance.now() - t0

// touching readFeatures at all is the thing under test, so the walk is opt-in
let sink = 0
if (walk) {
  for (const r of records) {
    const rf = r.readFeatures
    if (rf) {
      for (const f of rf) {
        sink += f.refPos
      }
    }
  }
}

const after = usage()

// after `after` on purpose: materialising the array-of-structs view here would
// otherwise be counted as retained
let featureCount = 0
for (const r of records) {
  featureCount += r.readFeatures?.length ?? 0
}

// what the slice cache weighed these same slices at, to set against the
// measured heap
let weighed = 0
for (const slice of new Set(records.map(r => r.slice))) {
  weighed += slice.byteLength
}

const mb = (n: number) => +(n / 1024 / 1024).toFixed(2)

console.log(
  JSON.stringify({
    case: c.name,
    walk,
    records: records.length,
    features: featureCount,
    retainedMB: mb(
      after.heapUsed -
        before.heapUsed +
        (after.arrayBuffers - before.arrayBuffers),
    ),
    jsHeapMB: mb(after.heapUsed - before.heapUsed),
    arrayBufferMB: mb(after.arrayBuffers - before.arrayBuffers),
    weighedMB: mb(weighed),
    decodeMs: +decodeMs.toFixed(1),
    sink,
  }),
)
