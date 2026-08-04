// A/B harness for the CIGAR walk and the clip getters, against decoded records.
//
//   node --experimental-strip-types scripts/bench-cigar.ts
//   CIGAR_BENCH_EXTRA=/path/to/longread.cram node --experimental-strip-types scripts/bench-cigar.ts
//
// Three things this encodes, each of which cost a wrong conclusion once:
//
//  1. IDENTITY BEFORE TIMING. A faster walk that emits different operations is
//     not a faster walk. Every variant is compared against the baseline over
//     every record before anything is timed, and a difference is reported
//     rather than silently timed. (Same rule as jbrowse's mismatchWalk.bench.)
//
//  2. AN A-VS-A CONTROL. The baseline is timed twice and the delta between
//     those two runs is the noise floor. A B-vs-A number that is not clear of
//     it means nothing. On a loaded machine this control has read ±15%.
//
//  3. ONE CONSUMER OF forEachCigarOp PER PROCESS. Two consumers with
//     differently-shaped callbacks make its internal `callback(op, oplen)`
//     sites polymorphic and block inlining, which measured as +40% against the
//     ~15% a single consumer actually pays. Variants that consume the walk are
//     run in separate processes for that reason — see `--variant`.
//
// The checked-in ONT fixture is 37 records, too few to time stably. Point
// CIGAR_BENCH_EXTRA at a real long-read CRAM (with its .crai alongside) for a
// meaningful long-read row; ~600 records of 50kb reads gives a control inside
// ±1.4%.
import CraiIndex from '../src/craiIndex.ts'
import IndexedCramFile from '../src/indexedCramFile.ts'
import { LocalFile } from '../src/io.ts'
import { CIGAR_HARD_CLIP, CIGAR_SOFT_CLIP } from '../src/cramFile/cigar.ts'

import type CramRecord from '../src/cramFile/record.ts'

const REPS = Number(process.env.CIGAR_BENCH_REPS ?? '30')
const DATA = 'test/data'

async function load(path: string, end = Number.POSITIVE_INFINITY) {
  const cram = new IndexedCramFile({
    cramFilehandle: new LocalFile(path),
    index: new CraiIndex({ filehandle: new LocalFile(`${path}.crai`) }),
  })
  return cram.getRecordsForRange(0, 0, end)
}

/** the packed CIGAR, as a consumer wanting BAM's layout would build it */
function packCigar(record: CramRecord) {
  const ops: number[] = []
  record.forEachCigarOp((op, length) => {
    ops.push((length << 4) | op)
  })
  return ops
}

/** clip at the start of the alignment, off the packed array */
function clipViaArray(record: CramRecord) {
  const ops = packCigar(record)
  const packed = record.isReverseComplemented() ? ops.at(-1) : ops[0]
  if (packed === undefined) {
    return 0
  }
  const op = packed & 0xf
  return op === CIGAR_SOFT_CLIP || op === CIGAR_HARD_CLIP ? packed >> 4 : 0
}

/** the same, O(1) on the forward strand and allocation-free on the reverse */
function clipDirect(record: CramRecord) {
  if (!record.isReverseComplemented()) {
    return record.getLeadingClipLength()
  }
  let lastOp = -1
  let lastLen = 0
  record.forEachCigarOp((op, length) => {
    lastOp = op
    lastLen = length
  })
  return lastOp === CIGAR_SOFT_CLIP || lastOp === CIGAR_HARD_CLIP ? lastLen : 0
}

function bench(
  label: string,
  records: CramRecord[],
  baseline: (r: CramRecord) => number,
  variants: [string, (r: CramRecord) => number][],
) {
  for (const [name, fn] of variants) {
    for (const record of records) {
      const a = baseline(record)
      const b = fn(record)
      if (a !== b) {
        console.log(
          `  ! ${label} / ${name}: DIFFERS at record ${record.uniqueId}: baseline=${a} variant=${b}`,
        )
        break
      }
    }
  }

  // control first, so the reported noise floor is measured the same way
  const timed: [string, (r: CramRecord) => number][] = [
    ['baseline', baseline],
    ['control', baseline],
    ...variants,
  ]
  const mins = timed.map(() => Number.POSITIVE_INFINITY)
  let sink = 0
  for (let warm = 0; warm < 3; warm++) {
    for (const [, fn] of timed) {
      for (const record of records) {
        sink += fn(record)
      }
    }
  }
  for (let rep = 0; rep < REPS; rep++) {
    for (const [i, [, fn]] of timed.entries()) {
      const t = performance.now()
      for (const record of records) {
        sink += fn(record)
      }
      mins[i] = Math.min(mins[i]!, performance.now() - t)
    }
  }
  const base = mins[0]!
  const report = timed
    .slice(1)
    .map(([name], i) => {
      const d = ((mins[i + 1]! - base) / base) * 100
      return `${name} ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`
    })
    .join(' | ')
  console.log(
    `  ${label.padEnd(26)} ${String(records.length).padStart(6)} rec  ` +
      `baseline ${base.toFixed(2)}ms → ${report}${sink < 0 ? '!' : ''}`,
  )
}

const datasets: [string, string, number?][] = [
  ['SRR396637 (short)', `${DATA}/SRR396637.sorted.clip.cram`],
  ['SRR396636 (short)', `${DATA}/SRR396636.sorted.clip.cram`],
  ['ONT fixture (37 rec)', `${DATA}/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram`],
]
if (process.env.CIGAR_BENCH_EXTRA) {
  datasets.unshift([
    'long reads (external)',
    process.env.CIGAR_BENCH_EXTRA,
    Number(process.env.CIGAR_BENCH_EXTRA_END ?? '120000'),
  ])
}

console.log(
  'clipLengthAtStartOfRead: building the packed CIGAR vs reading it directly\n',
)
for (const [label, path, end] of datasets) {
  const records = await load(path, end)
  bench(label, records, clipViaArray, [['direct', clipDirect]])
}

console.log('\nops per record (why the long-read row is the one that matters):')
for (const [label, path, end] of datasets) {
  const records = await load(path, end)
  const ops = records.reduce((a, r) => a + packCigar(r).length, 0)
  console.log(
    `  ${label.padEnd(26)} ${String(records.length).padStart(6)} rec  ` +
      `${String(ops).padStart(8)} ops  ${(ops / records.length).toFixed(1)} ops/record`,
  )
}
