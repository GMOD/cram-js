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
  ;[
    'auxf#values.tmp.cram',
    'c1#bounds.tmp.cram',
    'c1#clip.tmp.cram',
    'c1#noseq.tmp.cram',
    'c1#pad1.tmp.cram',
    'c1#pad2.tmp.cram',
    'c1#pad3.tmp.cram',
    'c1#unknown.tmp.cram',
    'c2#pad.tmp.cram',
    'ce#1.tmp.cram',
    'ce#1000.tmp.cram',
    'ce#2.tmp.cram',
    'ce#5.tmp.cram',
    'ce#5b.tmp.cram',
    'ce#large_seq.tmp.cram',
    'ce#supp.tmp.cram',
    'ce#tag_depadded.tmp.cram',
    'ce#tag_padded.tmp.cram',
    'ce#unmap.tmp.cram',
    'ce#unmap1.tmp.cram',
    'ce#unmap2.tmp.cram',
    'headernul.tmp.cram',
    'md#1.tmp.cram',
    'sam_alignment.tmp.cram',
    'xx#blank.tmp.cram',
    'xx#large_aux.tmp.cram',
    'xx#large_aux2.tmp.cram',
    'xx#minimal.tmp.cram',
    'xx#pair.tmp.cram',
    'xx#repeated.tmp.cram',
    'xx#rg.tmp.cram',
    'xx#tlen.tmp.cram',
    'xx#tlen2.tmp.cram',
    'xx#triplet.tmp.cram',
    'xx#unsorted.tmp.cram',
  ].forEach(filename => {
    it(`can read the first chrom of ${filename} without error`, async () => {
      const cram = new IndexedCramFile({
        cram: testDataFile(filename),
        index: new CramIndex(testDataFile(`${filename}.crai`)),
      })

      const features = await cram.getFeaturesForRange(0, 0, Infinity)
      // require('fs').writeFileSync(
      //   `test/data/${filename}.test2.expected.json`,
      //   JSON.stringify(features, null, '  '),
      // )
      // console.log(`${filename} first ref got ${features.length} features`)
      expect(features.length).to.be.greaterThan(-1)
    })
    it(`can read the second chrom of ${filename} without error`, async () => {
      const cram = new IndexedCramFile({
        cram: testDataFile(filename),
        index: new CramIndex(testDataFile(`${filename}.crai`)),
      })

      const features = await cram.getFeaturesForRange(1, 0, Infinity)
      // require('fs').writeFileSync(
      //   `test/data/${filename}.test3.expected.json`,
      //   JSON.stringify(features, null, '  '),
      // )
      // console.log(`${filename} second ref got ${features.length} features`)
      expect(features.length).to.be.greaterThan(-1)
    })
  })
})
