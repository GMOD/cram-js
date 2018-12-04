const { expect } = require('chai')
const { IndexedCramFile, CramFile, CraiIndex } = require('../src')

describe('1kg mate test', () => {
  describe('readme 1', () => {
    it('runs without error', async () => {

      const indexedCramFile = new IndexedCramFile({
        cram: new CramFile({
          url: 'https://s3.amazonaws.com/1000genomes/data/HG00096/alignment/HG00096.alt_bwamem_GRCh38DH.20150718.GBR.low_coverage.cram',
          seqFetch: async (seqId, start, end) => {
            let fakeSeq = ''
            for (let i = start; i <= end; i += 1) {
              fakeSeq += 'A'
            }
            return fakeSeq
          },
          checkSequenceMD5: false
        }),
        index: new CraiIndex({
          url: 'https://s3.amazonaws.com/1000genomes/data/HG00096/alignment/HG00096.alt_bwamem_GRCh38DH.20150718.GBR.low_coverage.cram.crai',
        })
      })

      // chr8:128,749,421-128,749,582
      const records = await indexedCramFile.getRecordsForRange(7, 128749421, 128749582)

      const downstreamMateRecord = records.filter(
        rec => 'SRR062634.138050' === rec.readName
      )[0]

      expect(downstreamMateRecord.isMateReverseComplemented()).to.equal(true)

      const detachedMateRecord = records.filter(
        rec => 'SRR062635.19801940' === rec.readName
      )[0]

      expect(detachedMateRecord.isMateReverseComplemented()).to.equal(true)

    }).timeout(10000)
  })
})
