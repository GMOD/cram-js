import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

const decodeWith = async (answer: string | undefined) => {
  let calls = 0
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
    ),
    index: new CraiIndex({
      filehandle: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
      ),
    }),
    fetchReferenceSequence: async () => {
      calls++
      return answer
    },
  })
  const records = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)
  return { calls, bases: records.map(r => r.getReadBases()) }
}

test('a callback that returns undefined decodes like one that returns an empty string', async () => {
  const [fromUndefined, fromEmpty] = await Promise.all([
    decodeWith(undefined),
    decodeWith(''),
  ])
  expect(fromUndefined.calls).toBeGreaterThan(0)
  expect(fromUndefined.bases.length).toBeGreaterThan(0)
  expect(fromUndefined.bases.some(b => b === undefined)).toBe(true)
  expect(fromUndefined.bases).toEqual(fromEmpty.bases)
})
