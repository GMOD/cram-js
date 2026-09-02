import { expect, test } from 'vitest'

import { testDataFile } from './lib/util.ts'
import DecodedSlice from '../src/cramFile/decodedSlice.ts'
import TagColumn from '../src/cramFile/tagColumn.ts'
import { CraiIndex, IndexedCramFile } from '../src/index.ts'

test('a decoded slice weighs at least its typed-array columns', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('ce#5.tmp.cram'),
    index: new CraiIndex({ filehandle: testDataFile('ce#5.tmp.cram.crai') }),
    fetchReferenceSequence: async (_seqId, start, end) =>
      'A'.repeat(end - start),
  })
  const records = await cram.getRecordsForRange(0, 0, 100000)
  expect(records.length).toBeGreaterThan(0)

  const slices = new Set(records.map(r => r.slice))
  let weighed = 0
  for (const slice of slices) {
    const typed =
      slice.scalars.byteLength +
      slice.presence.byteLength +
      slice.uniqueIds.byteLength +
      (slice.arena?.byteLength ?? 0) +
      (slice.qualityBytes?.byteLength ?? 0)
    expect(slice.byteLength).toBeGreaterThan(typed)
    weighed += slice.byteLength
  }
  // the cache charges exactly what the slices report
  expect(cram.cram.featureCache.totalSize).toBe(weighed)
})

test('strings count at their length plus a per-string overhead', () => {
  const slice = new DecodedSlice(2, new TagColumn(0))
  const bare = slice.byteLength
  slice.readNames[0] = 'x'.repeat(25)
  expect(slice.byteLength).toBe(bare + 25 + 32)
  slice.refRegions = new Map([
    [0, { start: 0, end: 100, seq: 'A'.repeat(100) }],
  ])
  expect(slice.byteLength).toBe(bare + 25 + 32 + 100 + 64)
})
