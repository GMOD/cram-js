import { bench, describe } from 'vitest'
import { testDataFile } from '../test/lib/util'
import CraiIndex from '../src/craiIndex'
import { IndexedCramFile } from '../src/index'

describe('CRAM parsing benchmarks', () => {
  bench(
    'parse SRR396637.sorted.clip.cram',
    async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('SRR396637.sorted.clip.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('SRR396637.sorted.clip.cram.crai'),
        }),
      })

      await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)
    },
    {
      iterations: 10,
    },
  )
})
