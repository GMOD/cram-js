const { expect } = require('chai')

const { testDataFile, loadTestJSON, extended } = require('./lib/util')
const { IndexedCramFile } = require('../src/index')
const IndexedFastaFile = require('./lib/fasta/indexedFasta')
const CramIndex = require('../src/cramIndex')

const expectedFeatures1 = loadTestJSON(
  'ce#tag_padded.tmp.cram.test1.expected.json',
)
const expectedFeatures2 = loadTestJSON('ce#unmap2.tmp.cram.test1.expected.json')
const expectedFeatures3 = loadTestJSON('ce#1000.tmp.cram.test1.expected.json')
const expectedFeatures4 = loadTestJSON(
  'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test1.expected.json',
)
const expectedFeatures5 = loadTestJSON(
  'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test2.expected.json',
)

describe('.crai indexed cram file', () => {
  it('can read ce#tag_padded.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile('ce#tag_padded.tmp.cram'),
      index: new CramIndex(testDataFile('ce#tag_padded.tmp.cram.crai')),
    })

    const features = await cram.getFeaturesForRange(0, 2, 200)
    expect(features).to.deep.equal(await expectedFeatures1)

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
    expect(features).to.deep.equal(await expectedFeatures2)
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
    expect(features).to.deep.equal(await expectedFeatures3)
  })

  it('can read human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram', async () => {
    const cram = new IndexedCramFile({
      cram: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
      ),
      index: new CramIndex(
        testDataFile(
          'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
        ),
      ),
    })

    const features = await cram.getFeaturesForRange(0, 0, Infinity)
    // require('fs').writeFileSync(
    //   'test/data/cramQueryWithCRAI.cram.test1.expected.json',
    //   JSON.stringify(features, null, '  '),
    // )
    expect(features).to.deep.equal(await expectedFeatures4)

    const features2 = await cram.getFeaturesForRange(-1, 0, Infinity)
    // require('fs').writeFileSync(
    //   'test/data/cramQueryWithCRAI.cram.test2.expected.json',
    //   JSON.stringify(features2, null, '  '),
    // )
    // console.log(JSON.stringify(features2, null, '  '))

    expect(features2).to.deep.equal(await expectedFeatures5)
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

  extended(
    'can fetch some regions of tomato example data correctly',
    async () => {
      const fasta = new IndexedFastaFile({
        fasta: testDataFile('extended/S_lycopersicum_chromosomes.2.50.fa'),
        fai: testDataFile('extended/S_lycopersicum_chromosomes.2.50.fa.fai'),
      })
      const cram = new IndexedCramFile({
        cram: testDataFile('extended/RNAseq_mapping_def.cram'),
        index: new CramIndex(
          testDataFile('extended/RNAseq_mapping_def.cram.crai'),
        ),
        // seqFetch: fasta.fetch.bind(fasta),
      })

      const features = await cram.getFeaturesForRange(1, 20000, 30000)
      // require('fs').writeFileSync(
      //   `test/data/extended/RNAseq_mapping_def.cram.test1.expected.json`,
      //   JSON.stringify(features, null, '  '),
      // )
      const expectedFeatures = await loadTestJSON(
        'extended/RNAseq_mapping_def.cram.test1.expected.json',
      )

      expect(features).to.deep.equal(expectedFeatures)
    },
  )
})
