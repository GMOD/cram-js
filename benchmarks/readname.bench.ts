import { bench, describe } from 'vitest'

import { IndexedCramFile, CraiIndex } from '../src/index.ts'

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

function makeCram(cramPath: string) {
  return new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: `${cramPath}.crai` }),
    seqFetch,
    checkSequenceMD5: false,
  })
}

const opts = { iterations: 100, warmupIterations: 10 }

describe('SRR396637 short reads (54k records)', () => {
  bench(
    'readName not accessed',
    async () => {
      const cram = makeCram('test/data/SRR396637.sorted.clip.cram')
      const records = await cram.getRecordsForRange(0, 0, 100_000_000)
      let sum = 0
      for (const r of records) {
        sum += r.alignmentStart + r.flags + r.readLength
      }
    },
    opts,
  )

  bench(
    'readName accessed',
    async () => {
      const cram = makeCram('test/data/SRR396637.sorted.clip.cram')
      const records = await cram.getRecordsForRange(0, 0, 100_000_000)
      let sum = 0
      for (const r of records) {
        sum += r.alignmentStart + r.flags + (r.readName?.length ?? 0)
      }
    },
    opts,
  )
})
