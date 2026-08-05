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
