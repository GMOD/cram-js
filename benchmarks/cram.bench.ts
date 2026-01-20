import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import {
  IndexedCramFile as IndexedCramFileBranch1,
  CraiIndex as CraiIndexBranch1,
} from '../esm_branch1/index.js'
import {
  IndexedCramFile as IndexedCramFileBranch2,
  CraiIndex as CraiIndexBranch2,
} from '../esm_branch2/index.js'

const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

function benchCram(
  name: string,
  cramPath: string,
  seqId: number,
  start: number,
  end: number,
  opts?: { iterations?: number; warmupIterations?: number },
) {
  describe(name, () => {
    bench(
      branch1Name,
      async () => {
        const cram = new IndexedCramFileBranch1({
          cramPath,
          index: new CraiIndexBranch1({ path: `${cramPath}.crai` }),
          seqFetch,
          checkSequenceMD5: false,
        })
        await cram.getRecordsForRange(seqId, start, end)
      },
      opts,
    )

    bench(
      branch2Name,
      async () => {
        const cram = new IndexedCramFileBranch2({
          cramPath,
          index: new CraiIndexBranch2({ path: `${cramPath}.crai` }),
          seqFetch,
          checkSequenceMD5: false,
        })
        await cram.getRecordsForRange(seqId, start, end)
      },
      opts,
    )
  })
}

benchCram(
  'SRR396637.sorted.clip.cram (2.5MB, short reads)',
  'test/data/SRR396637.sorted.clip.cram',
  0,
  0,
  100_000_000,
  { iterations: 50, warmupIterations: 5 },
)

benchCram(
  'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram (1.5MB, long reads)',
  'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
  0,
  0,
  100_000_000,
  { iterations: 50, warmupIterations: 5 },
)
