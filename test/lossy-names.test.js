const { expect } = require('chai')
const { IndexedCramFile, CramFile, CraiIndex } = require('../src')

describe('1kg mate test', () => {
  describe('readme 1', () => {
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


      // chr8:128,749,421-128,749,582
      const records = await indexedCramFile.getRecordsForRange(
        0,
        155140000,
        155160000,
      )

      const firstInPair = records[0]
      const secondInPair = records[1]

      expect(firstInPair.readName !== undefined).to.equal(true)
      expect(firstInPair.readName).to.equal(secondInPair.readName)
    }).timeout(10000)
  })
})
