import { expect, test } from 'vitest'

import CramRecord, { NEXT_UNKNOWN } from '../src/cramFile/record.ts'
import { associateIntraSliceMates } from '../src/cramFile/slice/index.ts'
import TagColumn from '../src/cramFile/tagColumn.ts'

import type { CramRecordArgs } from '../src/cramFile/record.ts'

// A minimal mapped, paired record. `mateRecordNumber` is what the decode leaves
// behind for an intra-slice mate — `NF + recordNumber + 1`, so a well-formed one
// always points *forward*.
// `readName: null` is a file that stored no name for this record — `undefined`
// cannot say that, since it is what a defaulted argument looks like.
function makeRecord(
  start: number,
  mateRecordNumber: number | undefined,
  readName: string | null = `read${start}`,
  overrides: Partial<CramRecordArgs> = {},
) {
  return new CramRecord({
    flags: 1 /* BAM_FPAIRED */,
    cramFlags: 0,
    readLength: 10,
    mappingQuality: 30,
    lengthOnRef: 10,
    qualityColumn: undefined,
    qualityStart: -1,
    mateRecordNumber,
    readBases: undefined,
    readFeatureArena: undefined,
    readFeatureStart: 0,
    readFeatureCount: 0,
    nextSequenceId: NEXT_UNKNOWN,
    nextStart: -1,
    readGroupId: 0,
    readName: readName ?? undefined,
    sequenceId: 0,
    uniqueId: start,
    templateSize: undefined,
    start,
    tagColumn: new TagColumn(),
    tagStart: 0,
    tagCount: 0,
    ...overrides,
  })
}

test('associates a plain forward mate pointer', () => {
  const records = [makeRecord(10, 1), makeRecord(30, undefined)]
  associateIntraSliceMates(records)
  expect(records[0]!.nextStart).toBe(30)
  expect(records[1]!.nextStart).toBe(10)
  // leftmost positive, rightmost negative, per the SAM spec
  expect(records[0]!.templateLength).toBe(30)
  expect(records[1]!.templateLength).toBe(-30)
})

// htslib's cram_decode_slice_xref is the reference for everything below: the
// span runs to the rightmost end on the reference, not start + read length
test('measures the template on the reference, not the read', () => {
  const records = [
    makeRecord(10, 1),
    makeRecord(30, undefined, 'read30', { lengthOnRef: 40 }),
  ]
  associateIntraSliceMates(records)
  expect(records[0]!.templateLength).toBe(60)
  expect(records[1]!.templateLength).toBe(-60)
})

test('breaks a tie between mates at identical coordinates with READ1', () => {
  const read2First = [
    makeRecord(10, 1, 'a', { flags: 1 | 128 }),
    makeRecord(10, undefined, 'a', { flags: 1 | 64 }),
  ]
  associateIntraSliceMates(read2First)
  expect(read2First.map(r => r.templateLength)).toEqual([-10, 10])

  const read1First = [
    makeRecord(10, 1, 'b', { flags: 1 | 64 }),
    makeRecord(10, undefined, 'b', { flags: 1 | 128 }),
  ]
  associateIntraSliceMates(read1First)
  expect(read1First.map(r => r.templateLength)).toEqual([10, -10])
})

test('gives 0 to a pair with an unmapped member', () => {
  const records = [
    makeRecord(10, 1),
    makeRecord(10, undefined, 'read10', {
      flags: 1 | 4,
      lengthOnRef: undefined,
    }),
  ]
  associateIntraSliceMates(records)
  expect(records.map(r => r.templateLength)).toEqual([0, 0])
  expect(records[0]!.isMateUnmapped()).toBe(true)
})

test('gives 0 to a pair spanning two references', () => {
  const records = [
    makeRecord(10, 1),
    makeRecord(30, undefined, 'read30', { sequenceId: 1 }),
  ]
  associateIntraSliceMates(records)
  expect(records.map(r => r.templateLength)).toEqual([0, 0])
  expect(records[0]!.nextSequenceId).toBe(1)
})

test('points the last segment of a chain back at the first', () => {
  const records = [
    makeRecord(10, 1),
    makeRecord(30, 2),
    makeRecord(50, undefined),
  ]
  associateIntraSliceMates(records)
  expect(records.map(r => r.nextStart)).toEqual([30, 50, 10])
  expect(records.map(r => r.templateLength)).toEqual([50, -50, -50])
})

// A backwards NF makes the multi-segment walk revisit records forever, growing
// its array until the process dies — 14 million entries in two seconds, and
// synchronously, so it cannot be interrupted. It has to be an error, not a hang.
test('throws rather than hanging on a cyclic mate chain', () => {
  // 0 -> 1 -> 2 -> 1: record 0 sees a mate that points elsewhere, which is what
  // sends it down the multi-segment path, and 1 <-> 2 is the cycle
  const records = [makeRecord(10, 1), makeRecord(30, 2), makeRecord(50, 1)]
  expect(() => {
    associateIntraSliceMates(records)
  }).toThrow(/cyclic/)
})

test('throws rather than hanging on a self-referential mate chain', () => {
  const records = [makeRecord(10, 1), makeRecord(30, 1)]
  expect(() => {
    associateIntraSliceMates(records)
  }).toThrow(/cyclic/)
})

test('still rejects a mate pointer past the end of the slice', () => {
  const records = [makeRecord(10, 5), makeRecord(30, undefined)]
  // out of range, so nothing is associated at all rather than throwing
  associateIntraSliceMates(records)
  expect(records[0]!.hasNextPosition()).toBe(false)
})

// A file written with lossy read names stores no name for a mate group that
// fits inside one slice, and the decode has to invent one they share. The
// uniqueId of the record holding the pointer is what it uses — see ADR 0011.
function makeLossyRecord(start: number, mateRecordNumber: number | undefined) {
  return makeRecord(start, mateRecordNumber, null)
}

test('gives a lossy-named pair one name, from the head of the chain', () => {
  const records = [makeLossyRecord(10, 1), makeLossyRecord(30, undefined)]
  associateIntraSliceMates(records)
  expect(records[0]!.readName).toBe('10')
  expect(records[1]!.readName).toBe('10')
})

test('carries a lossy name past the second segment of a chain', () => {
  const records = [
    makeLossyRecord(10, 1),
    makeLossyRecord(30, 2),
    makeLossyRecord(50, undefined),
  ]
  associateIntraSliceMates(records)
  // the last record used to come back with no name at all, because the walk
  // reached it from a record that had by then been named itself
  expect(records.map(r => r.readName)).toEqual(['10', '10', '10'])
})

test('spreads a stored name to a mate the file left unnamed', () => {
  const records = [makeRecord(10, 1), makeLossyRecord(30, undefined)]
  associateIntraSliceMates(records)
  expect(records[1]!.readName).toBe('read10')
})
