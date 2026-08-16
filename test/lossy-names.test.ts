import { describe, expect, it } from 'vitest'

import { CraiIndex, CramFile, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

describe('1kg mate test', () => {
  it('runs without error', async () => {
    const indexedCramFile = new IndexedCramFile({
      cramPath: require.resolve('./data/na12889_lossy.cram'),
      index: new CraiIndex({
        path: require.resolve('./data/na12889_lossy.cram.crai'),
      }),
      fetchReferenceSequence: async (seqId, start, end) => {
        let fakeSeq = ''
        for (let i = start; i <= end; i += 1) {
          fakeSeq += 'A'
        }
        return fakeSeq
      },
      checkSequenceMD5: false,
    })

    // Test lossy readnames (intra-slice pair)
    const chr1Records = await indexedCramFile.getRecordsForRange(
      0,
      155140000,
      155160000,
    )

    const firstMate = chr1Records[0]!
    const secondMate = chr1Records[1]!
    expect(firstMate.readName).not.toBeUndefined()
    expect(firstMate.readName).toEqual(secondMate.readName)

    // Test retained readnames (inter chr mates)
    const chr16Records = await indexedCramFile.getRecordsForRange(
      1,
      12100200,
      12100300,
    )

    const chr1mate = chr1Records[2]!
    const chr16mate = chr16Records[0]!
    expect(chr1mate.readName !== undefined).toEqual(true)
    expect(chr1mate.readName).toEqual(chr16mate.readName)
  })
})

// ce#lossy3seg.cram is three segments of one template, names dropped, chained
// 0 -> 1 -> 2 by a single NF walk — see scripts/make-lossy-chain-fixture.ts for
// what it takes to get htslib to write one. It is the only fixture here that
// reaches the second link of that walk, and before ADR 0011 the record on the
// far end of it came back with no name at all.
describe('three-segment lossy mate chain', () => {
  it('gives every record in the chain the same name', async () => {
    const cram = new CramFile({
      filehandle: testDataFile('ce#lossy3seg.cram'),
      checkSequenceMD5: false,
    })
    const container = await cram.getContainerById(1)
    const { landmarks, length } = await container!.getHeader()
    const slice = container!.getSlice(landmarks[0]!, length - landmarks[0]!)
    const records = await slice.getRecords(() => true)

    expect(records.length).toBe(3)
    const [first, middle, last] = records
    // the third is the one that used to be undefined
    expect(last!.readName).toBeDefined()
    expect(middle!.readName).toEqual(first!.readName)
    expect(last!.readName).toEqual(first!.readName)
    // named after the head of the chain, as htslib names a group
    expect(first!.readName).toEqual(String(first!.uniqueId))
  })
})
