import { expect, test } from 'vitest'

import CramRecord, { NEXT_UNKNOWN } from '../src/cramFile/record.ts'
import { associateIntraSliceMates } from '../src/cramFile/slice/index.ts'

// A minimal mapped, paired record. `mateRecordNumber` is what the decode leaves
// behind for an intra-slice mate — `NF + recordNumber + 1`, so a well-formed one
// always points *forward*.
function makeRecord(start: number, mateRecordNumber: number | undefined) {
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
    readName: `read${start}`,
    sequenceId: 0,
    uniqueId: start,
    templateSize: undefined,
    start,
    tags: {},
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
