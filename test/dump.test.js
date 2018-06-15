const { expect } = require('chai')
const testFileList = require('./lib/testFileList')
const { testDataFile, loadTestJSON } = require('./lib/util')
const { dumpWholeFile } = require('./lib/dumpFile')
const { CramFile } = require('../src/index')

describe('dumping cram files', () => {
  testFileList.forEach(filename => {
    // ;['xx#unsorted.tmp.cram'].forEach(filename => {
    it(`can dump the whole ${filename} without error`, async () => {
      const file = new CramFile(testDataFile(filename))
      const fileData = await dumpWholeFile(file)
      // console.log(JSON.stringify(fileData, null, '  '))
      // require('fs').writeFileSync(
      //   `test/data/${filename}.dump.json`,
      //   JSON.stringify(fileData, null, '  '),
      // )
      const expectedFeatures = await loadTestJSON(`${filename}.dump.json`)
      expect(JSON.parse(JSON.stringify(fileData))).to.deep.equal(
        expectedFeatures,
      )
    })
  })
})
