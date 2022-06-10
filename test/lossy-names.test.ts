//@ts-nocheck
import { CraiIndex, IndexedCramFile } from '../src'

describe('1kg mate test', () => {
  it('runs without error', async () => {
    const indexedCramFile = new IndexedCramFile({
      cramPath: require.resolve(`./data/na12889_lossy.cram`),
      index: new CraiIndex({
        path: require.resolve(`./data/na12889_lossy.cram.crai`),
      }),
      seqFetch: async (seqId, start, end) => {
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

    const firstMate = chr1Records[0]
    const secondMate = chr1Records[1]
    expect(firstMate.readName).not.toBeUndefined()
    expect(firstMate.readName).toEqual(secondMate.readName)

    // Test retained readnames (inter chr mates)
    const chr16Records = await indexedCramFile.getRecordsForRange(
      1,
      12100200,
      12100300,
    )

    const chr1mate = chr1Records[2]
    const chr16mate = chr16Records[0]
    expect(chr1mate.readName !== undefined).toEqual(true)
    expect(chr1mate.readName).toEqual(chr16mate.readName)
  })
})
