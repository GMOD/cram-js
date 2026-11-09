import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

const open = (fetchReferenceSequence: () => Promise<string | undefined>) =>
  new IndexedCramFile({
    cramFilehandle: testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
    ),
    index: new CraiIndex({
      filehandle: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
      ),
    }),
    fetchReferenceSequence,
  })

test('a callback that returns undefined decodes like one that returns an empty string', async () => {
  const [fromUndefined, fromEmpty] = await Promise.all([
    open(async () => undefined).getRecordsForRange(
      0,
      0,
      Number.POSITIVE_INFINITY,
    ),
    open(async () => '').getRecordsForRange(0, 0, Number.POSITIVE_INFINITY),
  ])
  expect(fromUndefined.length).toBeGreaterThan(0)
  expect(fromUndefined.map(r => r.getCigarString())).toEqual(
    fromEmpty.map(r => r.getCigarString()),
  )
})
