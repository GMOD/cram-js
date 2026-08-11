import { expect, test } from 'vitest'

import { arenaFromReadFeatures } from '../src/cramFile/readFeatureArena.ts'
import CramRecord from '../src/cramFile/record.ts'
import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type { Mismatch } from '../src/cramFile/mismatches.ts'
import type { ReadFeature } from '../src/cramFile/record.ts'

// bare record carrying just what forEachMismatch reads
function makeRecord(
  readFeatures: ReadFeature[],
  start = 100,
  qualityScores?: Uint8Array,
) {
  const arena = arenaFromReadFeatures(readFeatures)
  return Object.assign(Object.create(CramRecord.prototype), {
    flags: 0,
    readLength: 10,
    start,
    // a one-record slice, so this record's scores start at the front of the
    // slice-wide column
    qualityColumn: qualityScores,
    qualityStart: 0,
    readFeatureArena: arena,
    readFeatureStart: 0,
    readFeatureCount: arena.length,
  }) as CramRecord
}

// the readable form of a Mismatch, so failures say what actually came out
const show = (m: Mismatch) =>
  `${String.fromCharCode(m.code)}@${m.refPos}` +
  (m.length ? `/${m.length}ref` : '') +
  (m.bases ? `/"${m.bases}"` : '') +
  (m.clipLength ? `/${m.clipLength}read` : '') +
  (m.refBaseCode ? `/ref${String.fromCharCode(m.refBaseCode)}` : '') +
  (m.qual === -1 ? '' : `/q${m.qual}`)

const mismatchesOf = (
  readFeatures: ReadFeature[],
  start?: number,
  qualityScores?: Uint8Array,
) => makeRecord(readFeatures, start, qualityScores).getMismatches().map(show)

test('a substitution reports the substituted and reference bases', () => {
  expect(
    mismatchesOf([
      { code: 'X', data: 0, pos: 4, refPos: 104, ref: 'a', sub: 'T' },
    ]),
  ).toEqual(['X@104/1ref/"T"/refA'])
})

test('an unresolved substitution reports N with no reference base', () => {
  // what a file read without a seqFetch gives: no ref, no sub
  expect(mismatchesOf([{ code: 'X', data: 0, pos: 4, refPos: 104 }])).toEqual([
    'X@104/1ref/"N"',
  ])
})

test('a substitution carries the quality score of its read base', () => {
  const qual = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  expect(
    mismatchesOf(
      [{ code: 'X', data: 0, pos: 4, refPos: 104, sub: 'T' }],
      101,
      qual,
    ),
  ).toEqual([`X@104/1ref/"T"/q14`])
})

test('insertions, deletions, skips and clips', () => {
  expect(
    mismatchesOf([
      { code: 'S', data: 'ACGT', pos: 0, refPos: 100 },
      { code: 'I', data: 'GG', pos: 4, refPos: 104 },
      { code: 'D', data: 3, pos: 5, refPos: 105 },
      { code: 'N', data: 20, pos: 5, refPos: 108 },
      { code: 'H', data: 5, pos: 9, refPos: 129 },
    ]),
  ).toEqual([
    'S@100/4read',
    'I@104/"GG"/2read',
    'D@105/3ref',
    'N@108/20ref',
    'H@129/5read',
  ])
})

// 'b' is a stretch of verbatim bases, which align as matches, and 'P' consumes
// nothing — neither is a difference from the reference
test('verbatim bases and padding are not differences', () => {
  expect(
    mismatchesOf([
      { code: 'b', data: 'ACGT', pos: 0, refPos: 100 },
      { code: 'P', data: 2, pos: 4, refPos: 104 },
    ]),
  ).toEqual([])
})

test('a run of single-base i insertions becomes one insertion', () => {
  expect(
    mismatchesOf([
      { code: 'i', data: 'A', pos: 2, refPos: 102 },
      { code: 'i', data: 'C', pos: 3, refPos: 102 },
    ]),
  ).toEqual(['I@102/"AC"/2read'])
})

// q/Q report where a quality score sits in the read, so the Q following an
// inserted base carries a refPos behind the insertion — see RF_POSITIONAL.
// Letting it through flushes the accumulator and splits the insertion in two.
test('a Q between two i insertions does not split them', () => {
  expect(
    mismatchesOf([
      { code: 'i', data: 'A', pos: 2, refPos: 102 },
      { code: 'Q', data: 36, pos: 2, refPos: 101 },
      { code: 'i', data: 'C', pos: 3, refPos: 102 },
    ]),
  ).toEqual(['I@102/"AC"/2read'])
})

test('an insertion is reported before a substitution at the same position', () => {
  expect(
    mismatchesOf([
      { code: 'i', data: 'A', pos: 2, refPos: 102 },
      { code: 'X', data: 0, pos: 3, refPos: 102, sub: 'T' },
    ]),
  ).toEqual(['I@102/"A"/1read', 'X@102/1ref/"T"'])
})

test('the window restricts to differences touching the range', () => {
  const record = makeRecord([
    { code: 'X', data: 0, pos: 0, refPos: 100, sub: 'T' },
    { code: 'D', data: 10, pos: 1, refPos: 104 },
    { code: 'X', data: 0, pos: 2, refPos: 129, sub: 'G' },
  ])
  expect(record.getMismatches({ start: 120, end: 140 }).map(show)).toEqual([
    'X@129/1ref/"G"',
  ])
  // the deletion spans 105-114, so a window inside it still sees it
  expect(record.getMismatches({ start: 110, end: 112 }).map(show)).toEqual([
    'D@104/10ref',
  ])
})

test('the window is half-open, so `end` is outside it', () => {
  const record = makeRecord([
    { code: 'X', data: 0, pos: 0, refPos: 120, sub: 'T' },
  ])
  expect(record.getMismatches({ start: 100, end: 121 }).map(show)).toEqual([
    'X@120/1ref/"T"',
  ])
  // 120 is the first position outside [100, 120)
  expect(record.getMismatches({ start: 100, end: 120 })).toEqual([])
  expect(record.getMismatches({ start: 120, end: 121 }).map(show)).toEqual([
    'X@120/1ref/"T"',
  ])
})

test('a spanning deletion is outside a window that ends where it starts', () => {
  const record = makeRecord([{ code: 'D', data: 10, pos: 1, refPos: 104 }])
  // the deletion covers 104-113, so [100, 104) does not touch it
  expect(record.getMismatches({ start: 100, end: 104 })).toEqual([])
  expect(record.getMismatches({ start: 100, end: 105 }).map(show)).toEqual([
    'D@104/10ref',
  ])
})

test('origin shifts every reported position, and not the window', () => {
  const record = makeRecord([
    { code: 'S', data: 'AC', pos: 0, refPos: 100 },
    { code: 'i', data: 'A', pos: 2, refPos: 102 },
    { code: 'X', data: 0, pos: 3, refPos: 104, sub: 'T' },
    { code: 'D', data: 3, pos: 4, refPos: 106 },
  ])
  // record.start is 100, so an origin of 100 gives read-relative positions
  expect(record.getMismatches({ origin: record.start }).map(show)).toEqual([
    'S@0/2read',
    'I@2/"A"/1read',
    'X@4/1ref/"T"',
    'D@6/3ref',
  ])
  // the window stays in reference coordinates while the output does not
  expect(
    record.getMismatches({ start: 104, end: 105, origin: 100 }).map(show),
  ).toEqual(['X@4/1ref/"T"'])
})

test('forEachMismatch allocates nothing per difference', () => {
  const record = makeRecord([
    { code: 'X', data: 0, pos: 4, refPos: 104, sub: 'T' },
    { code: 'I', data: 'GG', pos: 5, refPos: 105 },
  ])
  const seen: number[] = []
  record.forEachMismatch(code => {
    seen.push(code)
  })
  expect(seen.map(c => String.fromCharCode(c))).toEqual(['X', 'I'])
})

test('a record with no read features has no differences', () => {
  const record = Object.assign(Object.create(CramRecord.prototype), {
    flags: 0,
    readLength: 10,
    start: 101,
    readFeatureArena: undefined,
    readFeatureStart: 0,
    readFeatureCount: 0,
  }) as CramRecord
  expect(record.getMismatches()).toEqual([])
})

// end to end: the differences of a real record, with the reference applied
test('reports differences from a real file', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
    }),
    // 0-based half-open since v10, so the string is `end - start` long
    fetchReferenceSequence: async (_id, start, end) => 'A'.repeat(end - start),
    checkSequenceMD5: false,
  })
  const records = await cram.getRecordsForRange(0, 0, 2000)
  const withDifferences = records.filter(r => r.getMismatches().length)
  expect(withDifferences.length).toBeGreaterThan(0)

  // every reported difference must sit inside the read's span on the reference,
  // and every substitution must name a base
  for (const record of withDifferences) {
    for (const m of record.getMismatches()) {
      expect(m.refPos).toBeGreaterThanOrEqual(record.start)
      if (String.fromCharCode(m.code) === 'X') {
        expect(m.bases).toMatch(/^[ACGTN]$/)
      }
    }
  }
})

// A 'B' feature is a read base stored verbatim with its own quality score,
// rather than through the substitution matrix an 'X' goes through. It aligns as
// a CIGAR match, so it is a difference only when the base it carries is not the
// reference base — which is why it needs the reference resolved before it can
// be reported at all. It is what a writer reaches for when the matrix cannot
// encode the base: md#1.tmp.cram stores a 'Y' this way.
test('a B feature reports nothing with no reference to compare against', () => {
  expect(
    mismatchesOf([{ code: 'B', data: ['Y', 37], pos: 4, refPos: 104 }]),
  ).toEqual([])
})

test('a B feature reports once the reference is applied', () => {
  const record = makeRecord([
    { code: 'B', data: ['Y', 37], pos: 4, refPos: 104 },
  ])
  // refPos 104 is the 5th base of a region starting at 100
  record.readFeatureArena!.refCodes[0] = 'a'.charCodeAt(0)
  expect(record.getMismatches().map(show)).toEqual(['X@104/1ref/"Y"/refA/q37'])
})

test('a B feature matching the reference is not a difference', () => {
  const record = makeRecord([
    { code: 'B', data: ['a', 37], pos: 4, refPos: 104 },
  ])
  record.readFeatureArena!.refCodes[0] = 'A'.charCodeAt(0)
  expect(record.getMismatches()).toEqual([])
})
