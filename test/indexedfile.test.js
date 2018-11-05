const { expect } = require('chai')

const {
  testDataFile,
  loadTestJSON,
  extended,
  JsonClone,
  REWRITE_EXPECTED_DATA,
  fs,
} = require('./lib/util')
const { IndexedCramFile } = require('../src/index')
const CraiIndex = require('../src/craiIndex')

describe('.crai indexed cram file', () => {
  it('can read ce#tag_padded.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('ce#tag_padded.tmp.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('ce#tag_padded.tmp.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 2, 200)
    if (REWRITE_EXPECTED_DATA)
      fs.writeFileSync(
        'test/data/ce#tag_padded.tmp.cram.test1.expected.json',
        JSON.stringify(features, null, '  '),
      )

    const expectedFeatures1 = loadTestJSON(
      'ce#tag_padded.tmp.cram.test1.expected.json',
    )

    expect(features.length).to.equal(8)
    expect(JsonClone(features)).to.deep.equal(await expectedFeatures1)

    expect(await cram.getRecordsForRange(1, 2, 200)).to.deep.equal([])
    expect(await cram.hasDataForReferenceSequence(1)).to.equal(false)
    expect(await cram.hasDataForReferenceSequence(0)).to.equal(true)
  })

  it('can read ce#unmap2.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('ce#unmap2.tmp.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('ce#unmap2.tmp.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 2, 200)
    if (REWRITE_EXPECTED_DATA)
      fs.writeFileSync(
        'test/data/ce#unmap2.tmp.cram.test1.expected.json',
        JSON.stringify(features, null, '  '),
      )

    const expectedFeatures2 = loadTestJSON(
      'ce#unmap2.tmp.cram.test1.expected.json',
    )
    expect(JsonClone(features)).to.deep.equal(await expectedFeatures2)
  })

  it('can read ce#1000.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('ce#1000.tmp.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('ce#1000.tmp.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 2, 200)
    features.sort((a, b) => a.readName.localeCompare(b.readName))
    if (REWRITE_EXPECTED_DATA)
      fs.writeFileSync(
        'test/data/ce#1000.tmp.cram.test1.expected.json',
        JSON.stringify(features, null, '  '),
      )
    const expectedFeatures3 = loadTestJSON(
      'ce#1000.tmp.cram.test1.expected.json',
    )
    expect(JsonClone(features)).to.deep.equal(await expectedFeatures3)
  }).timeout(4000)

  it('can read human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
      ),
      index: new CraiIndex({
        filehandle: testDataFile(
          'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
        ),
      }),
    })

    const features = await cram.getRecordsForRange(0, 0, Infinity)
    if (REWRITE_EXPECTED_DATA)
      fs.writeFileSync(
        'test/data/human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test1.expected.json',
        JSON.stringify(features, null, '  '),
      )
    const expectedFeatures4 = loadTestJSON(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test1.expected.json',
    )
    expect(JsonClone(features)).to.deep.equal(await expectedFeatures4)

    const features2 = await cram.getRecordsForRange(-1, 0, Infinity)

    if (REWRITE_EXPECTED_DATA)
      fs.writeFileSync(
        'test/data/human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test2.expected.json',
        JSON.stringify(features2, null, '  '),
      )
    // console.log(JSON.stringify(features2, null, '  '))
    const expectedFeatures5 = loadTestJSON(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.test2.expected.json',
    )

    expect(JsonClone(features2)).to.deep.equal(await expectedFeatures5)
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
        cramFilehandle: testDataFile(filename),
        index: new CraiIndex({ filehandle: testDataFile(`${filename}.crai`) }),
      })

      const features = await cram.getRecordsForRange(0, 0, Infinity)
      features.sort((a, b) => a.readName.localeCompare(b.readName))
      if (REWRITE_EXPECTED_DATA)
        fs.writeFileSync(
          `test/data/${filename}.test2.expected.json`,
          JSON.stringify(features, null, '  '),
        )
      // console.log(`${filename} first ref got ${features.length} features`)
      expect(features.length).to.be.greaterThan(-1)
      expect(JsonClone(features)).to.deep.equal(
        await loadTestJSON(`${filename}.test2.expected.json`),
      )
    }).timeout(4000)
    it(`can read the second chrom of ${filename} without error`, async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile(filename),
        index: new CraiIndex({ filehandle: testDataFile(`${filename}.crai`) }),
      })

      const features = await cram.getRecordsForRange(1, 0, Infinity)
      if (REWRITE_EXPECTED_DATA)
        fs.writeFileSync(
          `test/data/${filename}.test3.expected.json`,
          JSON.stringify(features, null, '  '),
        )
      // console.log(`${filename} second ref got ${features.length} features`)
      expect(features.length).to.be.greaterThan(-1)
      expect(JsonClone(features)).to.deep.equal(
        await loadTestJSON(`${filename}.test3.expected.json`),
      )
    })
  })

  extended(
    'can fetch some regions of tomato example data correctly',
    async () => {
      // const fasta = new IndexedFastaFile({
      //   fasta: testDataFile('extended/S_lycopersicum_chromosomes.2.50.fa'),
      //   fai: testDataFile('extended/S_lycopersicum_chromosomes.2.50.fa.fai'),
      // })
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('extended/RNAseq_mapping_def.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('extended/RNAseq_mapping_def.cram.crai'),
        }),
        // seqFetch: fasta.fetch.bind(fasta),
      })

      const features = await cram.getRecordsForRange(1, 20000, 30000)
      if (REWRITE_EXPECTED_DATA)
        fs.writeFileSync(
          `test/data/extended/RNAseq_mapping_def.cram.test1.expected.json`,
          JSON.stringify(features, null, '  '),
        )

      const expectedFeatures = await loadTestJSON(
        'extended/RNAseq_mapping_def.cram.test1.expected.json',
      )

      expect(JsonClone(features)).to.deep.equal(expectedFeatures)

      const moreFeatures = await cram.getRecordsForRange(6, 12437859, 12437959)
      if (REWRITE_EXPECTED_DATA)
        fs.writeFileSync(
          `test/data/extended/RNAseq_mapping_def.cram.test2.expected.json`,
          JSON.stringify(moreFeatures, null, '  '),
        )

      // const moreExpectedFeatures = await loadTestJSON(
      //   'extended/RNAseq_mapping_def.cram.test2.expected.json',
      // )

      const moreFeatures2 = await cram.getRecordsForRange(6, 4765916, 4768415)
      expect(moreFeatures2.length).to.equal(1)
      expect(moreFeatures2[0].readName).to.equal('7033952-2')
      expect(moreFeatures2[0].alignmentStart).to.equal(4767144)
    },
  )
})


describe('paired read test', () => {
  it('can read paired.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('paired.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('paired.cram.crai'),
      }),
    })
    const cramResult = new IndexedCramFile({
      cramFilehandle: testDataFile('paired-region.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('paired-region.cram.crai'),
      }),
    })
    const features = await cram.getRecordsForRange(19, 62501, 64500, {
      viewAsPairs: true,
    })
    const features2 = await cramResult.getRecordsForRange(0, 1, 70000)
    expect(features.map(f => f.readName).sort()).to.deep.equal(
      features2.map(f => f.readName).sort(),
    )
  })
})


describe('paired orientation test', () => {
  it('can read long_pair.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('long_pair.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('long_pair.cram.crai'),
      }),
    })
    const cramResult = new IndexedCramFile({
      cramFilehandle: testDataFile('paired-region.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('paired-region.cram.crai'),
      }),
    })
    const features = await cram.getRecordsForRange(0, 15767, 28287, {
      viewAsPairs: true,
    })
    let feat1, feat2
    for(let i = 0; i < features.length; i++) {
      if(features[i].readName === 'HWI-EAS14X_10277_FC62BUY_4_24_15069_16274#0') {
        if(features[i].isRead1()) {
          feat1 = features[i]
        } else if(features[i].isRead2()) {
          feat2 = features[i]
        }
      }
    }
    expect(feat1.getPairOrientation()).to.equal('R2F1')
    expect(feat2.getPairOrientation()).to.equal('R2F1')
  })
})
