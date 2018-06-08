const { expect } = require('chai')

const { testDataFile } = require('./lib/util')
const { IndexedCramFile } = require('../src/index')
const CramIndex = require('../src/cramIndex')
const expectedFeatures1 = require('./data/ce#tag_padded.tmp.cram.test1.expected.json')
const expectedFeatures2 = require('./data/ce#unmap2.tmp.cram.test1.expected.json')
const expectedFeatures3 = require('./data/ce#1000.tmp.cram.test1.expected.json')

describe('.crai indexed cram file', () => {
  it('can read ce#tag_padded.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile('ce#tag_padded.tmp.cram'),
      index: new CramIndex(testDataFile('ce#tag_padded.tmp.cram.crai')),
    })

    const features = await cram.getFeaturesForRange(0, 2, 200)
    expect(features).to.deep.equal(expectedFeatures1)

    expect(await cram.getFeaturesForRange(1, 2, 200)).to.deep.equal([])
  })

  it('can read ce#unmap2.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile('ce#unmap2.tmp.cram'),
      index: new CramIndex(testDataFile('ce#unmap2.tmp.cram.crai')),
    })

    const features = await cram.getFeaturesForRange(0, 2, 200)
    // require('fs').writeFileSync(
    //   'test/data/ce#unmap2.tmp.cram.test1.expected.json',
    //   JSON.stringify(features, null, '  '),
    // )
    expect(features).to.deep.equal(expectedFeatures2)
  })

  it('can read ce#1000.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile('ce#1000.tmp.cram'),
      index: new CramIndex(testDataFile('ce#1000.tmp.cram.crai')),
    })

    const features = await cram.getFeaturesForRange(0, 2, 200)
    // require('fs').writeFileSync(
    //   'test/data/ce#1000.tmp.cram.test1.expected.json',
    //   JSON.stringify(features, null, '  '),
    // )
    expect(features).to.deep.equal(expectedFeatures3)
  })
})
