const { expect } = require('chai')

const { testDataFile } = require('./lib/util')
const { IndexedCramFile } = require('../src/index')
const CramIndex = require('../src/cramIndex')

describe('.crai indexed cram file', () => {
  it('can read ce#tag_padded.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile('ce#tag_padded.tmp.cram'),
      index: new CramIndex(testDataFile('ce#tag_padded.tmp.cram.crai')),
    })

    const features = await cram.getFeaturesForRange(0, 2, 200)
    //console.log(JSON.stringify(features, null, '  '))
    expect(features).to.deep.equal([])
  })
})
