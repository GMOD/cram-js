const { expect } = require('chai')
const { fullFiles: testFileList } = require('./lib/testFileList')
const {
  testDataFile,
  loadTestJSON,
  REWRITE_EXPECTED_DATA,
  fs,
} = require('./lib/util')
const { dumpWholeFile } = require('./lib/dumpFile')
const { CramFile } = require('../src/index')
const { FetchableSmallFasta } = require('./lib/fasta')

describe('dumping cram files', () => {
  testFileList.forEach(filename => {
    // ;['xx#unsorted.tmp.cram'].forEach(filename => {
    it(`can dump the whole ${filename} without error`, async () => {
      let seqFetch
      if (filename.includes('#')) {
        const referenceFileName = filename.replace(/#.+$/, '.fa')
        const fasta = new FetchableSmallFasta(testDataFile(referenceFileName))
        seqFetch = fasta.fetch.bind(fasta)
      }

      const filehandle = testDataFile(filename)
      const file = new CramFile({ filehandle, seqFetch })
      const fileData = await dumpWholeFile(file)
      // console.log(JSON.stringify(fileData, null, '  '))
      if (REWRITE_EXPECTED_DATA)
        fs.writeFileSync(
          `test/data/${filename}.dump.json`,
          JSON.stringify(fileData, null, '  '),
        )
      const expectedFeatures = await loadTestJSON(`${filename}.dump.json`)
      expect(JSON.parse(JSON.stringify(fileData))).to.deep.equal(
        expectedFeatures,
      )
    }).timeout(3000)
  })
})
