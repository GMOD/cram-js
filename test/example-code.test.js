const { expect } = require('chai')
const { IndexedCramFile, CraiIndex } = require('../src')

console.log(process.cwd())

describe('code examples', () => {
  describe('readme 1', () => {
    it('runs without error', async () => {
      const messages = []
      const console = {
        log(msg) {
          messages.push(msg)
        },
      }

      // or with local files
      const indexedFile2 = new IndexedCramFile({
        cramPath: require.resolve(`./data/ce#5.tmp.cram`),
        index: new CraiIndex({
          path: require.resolve(`./data/ce#5.tmp.cram.crai`),
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

      // example of fetching records from an indexed CRAM file.
      // NOTE: only numeric IDs for the reference sequence are accepted
      const records = await indexedFile2.getRecordsForRange(0, 10000, 20000)
      records.forEach(record => {
        console.log(`got a record named ${record.readName}`)
        record.readFeatures.forEach(({ code, refPos, ref, sub }) => {
          if (code === 'X')
            console.log(
              `${
                record.readName
              } shows a base substitution of ${ref}->${sub} at ${refPos}`,
            )
        })
      })

      expect(messages).to.deep.equal([
        'got a record named VI',
        'VI shows a base substitution of A->C at 2',
        'VI shows a base substitution of A->C at 28',
        'VI shows a base substitution of A->C at 100029',
        'VI shows a base substitution of A->C at 100101',
      ])
    })
  })
})
