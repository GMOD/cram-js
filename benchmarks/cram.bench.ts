import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'
import { LocalFile } from 'generic-filehandle2'

import { IndexedCramFile as IndexedCramFileBranch1 } from '../esm_branch1/index.js'
import { CraiIndex as CraiIndexBranch1 } from '../esm_branch1/index.js'
import { IndexedCramFile as IndexedCramFileBranch2 } from '../esm_branch2/index.js'
import { CraiIndex as CraiIndexBranch2 } from '../esm_branch2/index.js'

const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

function benchCram(
  name: string,
  cramPath: string,
  refSeqId: number,
  start: number,
  end: number,
  opts?: { iterations?: number; warmupIterations?: number },
) {
  describe(name, () => {
    bench(
      branch1Name,
      async () => {
        const cram = new IndexedCramFileBranch1({
          cramFilehandle: new LocalFile(cramPath),
          index: new CraiIndexBranch1({
            filehandle: new LocalFile(`${cramPath}.crai`),
          }),
        })
        await cram.cram.getSamHeader()
        await cram.getRecordsForRange(refSeqId, start, end)
      },
      opts,
    )

    bench(
      branch2Name,
      async () => {
        const cram = new IndexedCramFileBranch2({
          cramFilehandle: new LocalFile(cramPath),
          index: new CraiIndexBranch2({
            filehandle: new LocalFile(`${cramPath}.crai`),
          }),
        })
        await cram.cram.getSamHeader()
        await cram.getRecordsForRange(refSeqId, start, end)
      },
      opts,
    )
  })
}

benchCram(
  'ce#tag_padded.tmp.cram (1KB)',
  'test/data/ce#tag_padded.tmp.cram',
  0,
  0,
  10000,
  { iterations: 500, warmupIterations: 50 },
)

benchCram(
  'ce#1000.tmp.cram (138KB)',
  'test/data/ce#1000.tmp.cram',
  0,
  0,
  100000,
  { iterations: 100, warmupIterations: 10 },
)

benchCram(
  'SRR396637.sorted.clip.cram (2.5MB)',
  'test/data/SRR396637.sorted.clip.cram',
  0,
  0,
  100000000,
  { iterations: 20, warmupIterations: 2 },
)

benchCram(
  'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram (1.5MB)',
  'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
  0,
  0,
  100000000,
  { iterations: 20, warmupIterations: 2 },
)
