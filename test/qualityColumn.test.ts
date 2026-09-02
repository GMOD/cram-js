import { expect, test } from 'vitest'

import { bareRecord } from './lib/bareRecord.ts'
import {
  externalQualityColumn,
  growableQualityColumn,
  readQualityScores,
  trimQualityColumn,
} from '../src/cramFile/qualityColumn.ts'

// a record reading out of a slice-wide column shared with other records
const recordOver = (
  qualityColumn: Uint8Array | undefined,
  qualityStart: number,
  readLength: number,
  flags = 0,
  cramFlags = 0,
) =>
  bareRecord({
    flags,
    cramFlags,
    readLength,
    qualityColumn,
    qualityStart,
  })

// every file in test/data encodes QS as a plain external block, so the growable
// column below is only reached by CRAMs whose QS uses some other encoding
// (huffman, byte-array-length). These cover it directly.

const scoresFrom = (values: number[]) => {
  let i = 0
  return () => values[i++]!
}

test('a growable column lays records end to end', () => {
  const column = growableQualityColumn()
  const first = readQualityScores(column, 3, scoresFrom([1, 2, 3]))
  const second = readQualityScores(column, 2, scoresFrom([4, 5]))

  expect(first).toBe(0)
  expect(second).toBe(3)
  expect(column.length).toBe(5)
  expect([...column.bytes.subarray(0, 5)]).toEqual([1, 2, 3, 4, 5])
})

test('a growable column keeps earlier records when it grows', () => {
  const column = growableQualityColumn()
  const initialCapacity = column.bytes.length
  const first = readQualityScores(column, 4, scoresFrom([9, 9, 9, 9]))

  // one record longer than the whole initial buffer, so the column has to grow
  // and copy what is already in it
  const long = new Array(initialCapacity * 2).fill(7)
  const second = readQualityScores(column, long.length, scoresFrom(long))

  expect(column.bytes.length).toBeGreaterThan(initialCapacity)
  expect([...column.bytes.subarray(first, first + 4)]).toEqual([9, 9, 9, 9])
  expect(column.bytes[second]).toBe(7)
  expect(column.length).toBe(4 + long.length)
})

test('trimming a growable column gives back the unused capacity', () => {
  const column = growableQualityColumn()
  readQualityScores(column, 3, scoresFrom([1, 2, 3]))
  expect(column.bytes.length).toBeGreaterThan(3)

  trimQualityColumn(column)
  expect(column.bytes.length).toBe(3)
  expect([...column.bytes]).toEqual([1, 2, 3])
})

test('an external column advances the block cursor without copying', () => {
  const block = new Uint8Array([10, 11, 12, 13, 14, 15])
  const cursor = { bitPosition: 7 as const, bytePosition: 0 }
  const column = externalQualityColumn(block, cursor)

  const shouldNotBeCalled = () => {
    throw new Error('the external path must not decode value by value')
  }
  expect(readQualityScores(column, 2, shouldNotBeCalled)).toBe(0)
  expect(readQualityScores(column, 3, shouldNotBeCalled)).toBe(2)
  expect(cursor.bytePosition).toBe(5)
  // the block itself is the column, so nothing was allocated to hold the scores
  expect(column.bytes).toBe(block)
})

test('an external column refuses to read past the end of its block', () => {
  const cursor = { bitPosition: 7 as const, bytePosition: 0 }
  const column = externalQualityColumn(new Uint8Array(4), cursor)

  expect(() => readQualityScores(column, 5, () => 0)).toThrow(
    /beyond end of block/,
  )
})

test('trimming leaves an external column alone', () => {
  const block = new Uint8Array([1, 2, 3, 4])
  const cursor = { bitPosition: 7 as const, bytePosition: 0 }
  const column = externalQualityColumn(block, cursor)
  readQualityScores(column, 2, () => 0)

  trimQualityColumn(column)
  // it is the QS block, not a buffer of ours to shrink
  expect(column.bytes).toBe(block)
})

test('an external column does not pin the buffer its block is a view into', () => {
  // what a `raw` QS block looks like: a view into the slice's whole payload
  // read, which the records would otherwise keep reachable for as long as they
  // are cached — the compressed bytes of every other block along with it
  const sliceBytes = new Uint8Array(4096)
  sliceBytes.set([1, 2, 3, 4], 1000)
  const block = sliceBytes.subarray(1000, 1004)
  const cursor = { bitPosition: 7 as const, bytePosition: 0 }

  const column = externalQualityColumn(block, cursor)

  expect([...column.bytes]).toEqual([1, 2, 3, 4])
  expect(column.bytes.buffer.byteLength).toBe(4)
})

test('an external column over a block that owns its buffer copies nothing', () => {
  // the usual case: a decompressed block owns its buffer exactly
  const block = new Uint8Array([1, 2, 3, 4])
  const column = externalQualityColumn(block, {
    bitPosition: 7,
    bytePosition: 0,
  })

  expect(column.bytes).toBe(block)
})

test('a record reads only its own stretch of the shared column', () => {
  // three records of 2 scores each in one column
  const column = new Uint8Array([1, 2, 3, 4, 5, 6])
  const second = recordOver(column, 2, 2)

  expect([...second.qualityScores!]).toEqual([3, 4])
  expect(second.qualityScoreAt(0)).toBe(3)
  expect(second.qualityScoreAt(1)).toBe(4)
})

test('a record with no scores reports undefined, and -1 per base', () => {
  const record = recordOver(undefined, -1, 5)

  expect(record.qualityScores).toBeUndefined()
  expect(record.qualityScoreAt(0)).toBe(-1)
})

test("a '*' record reports null rather than undefined", () => {
  // unmapped (BAM 0x4) plus the CRAM no-sequence flag (0x8): neither bases nor
  // scores, which this library has always reported as null
  const record = recordOver(undefined, -1, 5, 0x4, 0x8)

  expect(record.qualityScores).toBeNull()
})
