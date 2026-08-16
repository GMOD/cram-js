import { readdirSync } from 'fs'

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
// 0 -> 1 -> 2 — the only fixture reaching the second link of the mate walk, and
// before ADR 0011 the record on the far end came back unnamed. See
// scripts/make-lossy-chain-fixture.ts for what it takes to get htslib to write.
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

// htslib stores a name for exactly the detached records, and a record leaves
// the detached state only by becoming one end of an NF link. So every nameless
// record sits on a chain the mate walk reaches, and the walk must name all of
// it — the guard that catches the three-segment hole without knowing to look
// for it. Pre-fix this reports ce#lossy3seg.cram; post-fix, nothing.
describe('read names across the corpus', () => {
  const cramFiles = readdirSync('test/data').filter(f => f.endsWith('.cram'))

  // a header and no records, on purpose. Named rather than tolerated, so a
  // fixture that quietly stops decoding anything fails here instead of passing
  // this sweep by having nothing to check.
  const empty = new Set([
    'hg19mini#cramQueryTestEmpty.cram',
    'xx#blank.2.1.cram',
    'xx#blank.3.0.cram',
    'xx#blank.tmp.cram',
  ])

  it.each(cramFiles)('%s decodes every record with a name', async filename => {
    const cram = new CramFile({
      filehandle: testDataFile(filename),
      checkSequenceMD5: false,
    })
    const unnamed: number[] = []
    let records = 0
    const containerCount = await cram.containerCount()
    for (let i = 1; i < containerCount; i++) {
      const container = await cram.getContainerById(i)
      const header = await container?.getHeader()
      if (!header) {
        continue
      }
      const { numLandmarks, landmarks, length } = header
      for (let j = 0; j < numLandmarks; j++) {
        const start = landmarks[j]!
        const end = j + 1 < numLandmarks ? landmarks[j + 1]! : length
        const slice = container!.getSlice(start, end - start)
        for (const record of await slice.getRecords(() => true)) {
          records++
          if (record.readName === undefined) {
            unnamed.push(record.uniqueId)
          }
        }
      }
    }
    expect(records > 0).toBe(!empty.has(filename))
    // the ids rather than a count, so a failure says which records to look at
    expect(unnamed).toEqual([])
  })
})
