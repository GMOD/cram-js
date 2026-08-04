import { expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

// The reference MD5 check is opt-in: it needs the whole span a slice was
// written against, which for a big slice is many megabases the query itself
// would never have fetched. The default was documented as `true` for years
// while the implementation left it undefined — no test caught it, because every
// other test in this repo passes `checkSequenceMD5: false` explicitly. These
// two pin the default down from both sides.
//
// `ce#5.tmp.cram` records an MD5 for its slice, and the callback below hands
// back a reference of the right length but entirely the wrong bases, so the
// check fires whenever it is on.
function open(checkSequenceMD5?: boolean) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile('ce#5.tmp.cram'),
    index: new CraiIndex({ filehandle: testDataFile('ce#5.tmp.cram.crai') }),
    fetchReferenceSequence: async (_seqId, start, end) =>
      'A'.repeat(end - start),
    checkSequenceMD5,
  })
}

test('the reference MD5 check is off by default', async () => {
  const records = await open().getRecordsForRange(0, 10000, 20000)
  expect(records.length).toBeGreaterThan(0)
})

test('checkSequenceMD5: true rejects a mismatched reference', async () => {
  await expect(open(true).getRecordsForRange(0, 10000, 20000)).rejects.toThrow(
    /MD5 checksum reference mismatch/,
  )
})

test('checkSequenceMD5: false decodes the same records as the default', async () => {
  const [byDefault, explicit] = await Promise.all([
    open().getRecordsForRange(0, 10000, 20000),
    open(false).getRecordsForRange(0, 10000, 20000),
  ])
  expect(explicit.map(r => r.uniqueId)).toEqual(byDefault.map(r => r.uniqueId))
})
