// The paths a consumer walks *after* a decode, which cram.bench.ts does not
// reach: it times getRecordsForRange and stops there. These are what the
// read-feature arena's layout decisions actually cost — see docs/memory.md.
//
// Run with `pnpm bench` (branch against origin/main by default).
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

// a real sequence rather than a run of one base, so substitutions and verbatim
// bases resolve to something the walks actually branch on
const fetchReferenceSequence = async (
  _seqId: number,
  start: number,
  end: number,
) => 'ACGT'.repeat(Math.ceil((end - start) / 4)).slice(0, end - start)

function open(Cram: any, Crai: any, cramPath: string) {
  return new Cram({
    cramPath,
    index: new Crai({ path: `${cramPath}.crai` }),
    fetchReferenceSequence,
    checkSequenceMD5: false,
  })
}

const decode = (Cram: any, Crai: any, cramPath: string) =>
  open(Cram, Crai, cramPath).getRecordsForRange(0, 0, 100_000_000)

/**
 * Both branches' records, decoded once. The walks below are timed against a
 * held record set, so what they measure is the walk and not the decode.
 */
async function bothBranches(cramPath: string) {
  return {
    branch1: await decode(IndexedCramFileBranch1, CraiIndexBranch1, cramPath),
    branch2: await decode(IndexedCramFileBranch2, CraiIndexBranch2, cramPath),
  }
}

function benchWalks(name: string, cramPath: string, records: any) {
  const opts = { iterations: 20, warmupIterations: 3 }
  let sink = 0

  // the mismatch walk, which is what jbrowse's pileup renders from
  describe(`${name} — forEachMismatch`, () => {
    for (const [label, recs] of [
      [branch1Name, records.branch1],
      [branch2Name, records.branch2],
    ] as const) {
      bench(
        label,
        () => {
          for (const record of recs) {
            record.forEachMismatch((_code: number, pos: number) => {
              sink += pos
            })
          }
        },
        opts,
      )
    }
  })

  // the array-of-structs escape hatch, rebuilt per call
  describe(`${name} — readFeatures`, () => {
    for (const [label, recs] of [
      [branch1Name, records.branch1],
      [branch2Name, records.branch2],
    ] as const) {
      bench(
        label,
        () => {
          for (const record of recs) {
            for (const feature of record.readFeatures ?? []) {
              sink += feature.pos
            }
          }
        },
        opts,
      )
    }
  })

  // getReadBases memoizes per record, so timing it over a held record set would
  // time the memo from the second iteration on. Decoding inside the body is the
  // honest form: subtract cram.bench.ts's decode row to read the bases cost.
  describe(`${name} — decode + getReadBases`, () => {
    for (const [label, Cram, Crai] of [
      [branch1Name, IndexedCramFileBranch1, CraiIndexBranch1],
      [branch2Name, IndexedCramFileBranch2, CraiIndexBranch2],
    ] as const) {
      bench(
        label,
        async () => {
          for (const record of await decode(Cram, Crai, cramPath)) {
            sink += record.getReadBases()?.length ?? 0
          }
        },
        { iterations: 10, warmupIterations: 2 },
      )
    }
  })
}

const ont = 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram'
const illumina = 'test/data/SRR396637.sorted.clip.cram'

benchWalks('long reads', ont, await bothBranches(ont))
benchWalks('short reads', illumina, await bothBranches(illumina))
