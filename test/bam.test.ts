import { expect, test } from 'vitest'

import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

test('read bam file and expect error', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('volvox-sorted.bam'),
    index: new CraiIndex({
      filehandle: testDataFile('volvox-sorted.cram.crai'),
    }),
  })

  await expect(cram.getRecordsForRange(0, 2, 200)).rejects.toThrow(
    /Not a CRAM file/,
  )
})
