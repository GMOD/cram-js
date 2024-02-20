//@ts-nocheck
import { loadTestJSON, testDataFile } from './lib/util'
import { IndexedCramFile } from '../src/index'
import CraiIndex from '../src/craiIndex'
import CramRecord from '../src/cramFile/record'

describe('.crai indexed cram file', () => {
  it('can read ce#tag_padded.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('ce#tag_padded.tmp.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('ce#tag_padded.tmp.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 2, 200)
    expect(features).toMatchSnapshot()

    expect(await cram.getRecordsForRange(1, 2, 200)).toEqual([])
    expect(await cram.hasDataForReferenceSequence(1)).toEqual(false)
    expect(await cram.hasDataForReferenceSequence(0)).toEqual(true)
  })

  it('can read ce#unmap2.tmp.cram', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('ce#unmap2.tmp.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('ce#unmap2.tmp.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 2, 200)
    expect(features).toMatchSnapshot()
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
    expect(features).toMatchSnapshot()
  })

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
    const features2 = await cram.getRecordsForRange(-1, 0, Infinity)
    expect(features).toMatchSnapshot()
    expect(features2).toMatchSnapshot()
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
      expect(features.length).toBeGreaterThan(-1)
      expect(features).toMatchSnapshot()
    })

    it(`can read the second chrom of ${filename} without error`, async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile(filename),
        index: new CraiIndex({ filehandle: testDataFile(`${filename}.crai`) }),
      })

      const features = await cram.getRecordsForRange(1, 0, Infinity)
      expect(features.length).toBeGreaterThan(-1)
      expect(features).toMatchSnapshot()
    })
  })
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
    expect(features.map(f => f.readName).sort()).toEqual(
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

    const features = await cram.getRecordsForRange(0, 15767, 28287, {
      viewAsPairs: true,
    })

    let feat1
    let feat2
    for (let i = 0; i < features.length; i += 1) {
      if (
        features[i].readName === 'HWI-EAS14X_10277_FC62BUY_4_24_15069_16274#0'
      ) {
        if (features[i].isRead1()) {
          feat1 = features[i]
        } else if (features[i].isRead2()) {
          feat2 = features[i]
        }
      }
    }
    expect(feat1.getPairOrientation()).toEqual('R2F1')
    expect(feat2.getPairOrientation()).toEqual('R2F1')
  })
})

describe('duplicate IDs test', () => {
  it('duplicates from single request', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('SRR396637.sorted.clip.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('SRR396637.sorted.clip.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 163504, 175473)
    const totalMap = {}
    let noCollisions = true
    for (let i = 0; i < features.length; i += 1) {
      const feature = features[i]
      if (
        totalMap[feature.uniqueId] &&
        totalMap[feature.uniqueId] !== feature.readName
      ) {
        noCollisions = false
        console.log('collision', totalMap[feature.uniqueId], feature.readName)
      } else {
        totalMap[feature.uniqueId] = feature.readName
      }
    }

    expect(noCollisions).toEqual(true)
  })
})

describe('match samtools', () => {
  it('matches names given from samtools', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 25999, 26499)

    const featNames = await loadTestJSON('SRR396636.expected.names.json')
    expect(features.map(f => f.readName)).toEqual(featNames)
    expect(features.length).toEqual(406)
  })
})

describe('getHeaderText', () => {
  it('matches names given from samtools', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
      }),
    })

    const header = await cram.cram.getHeaderText()
    expect(header.startsWith('@HD')).toEqual(true)
  })
})

describe('region not downloading enough records', () => {
  it('index file slice check', async () => {
    // long reads revealed this issue where the index was returning the wrong
    // entries
    const index = new CraiIndex({
      filehandle: testDataFile(
        'HG002_ONTrel2_16x_RG_HP10xtrioRTG.chr1.cram.crai ',
      ),
    })
    const entries = await index.getEntriesForRange(0, 75100635, 75125544)
    expect(entries.length).toEqual(2)
    expect(entries[0].start).toEqual(74378949)
    expect(entries[1].start).toEqual(74945118)
  })
})

describe('troublesome file', () => {
  it('returns the correct sequence', async () => {
    const seq = `GATCACAGGTCTATCACCCTATTAACCACTCACGGGAGCTCTCCATGCATTTGGTATTTT
CGTCTGGGGGGTATGCACGCGATAGCATTGCGAGACGCTGGAGCCGGAGCACCCTATGTC
GCAGTATCTGTCTTTGATTCCTGCCTCATCCTATTATTTATCGCACCTACGTTCAATATT
ACAGGCGAACATACTTACTAAAGTGTGTTAATTAATTAATGCTTGTAGGACATAATAATA
ACAATTGAATGTCTGCACAGCCACTTTCCACACAGACATCATAACAAAAAATTTCCACCA
AACCCCCCCTCCCCCGCTTCTGGCCACAGCACTTAAACACATCTCTGCCAAACCCCAAAA
ACAAAGAACCCTAACACCAGCCTAACCAGATTTCAAATTTTATCTTTTGGCGGTATGCAC
TTTTAACAGTCACCCCCCAACTAACACATTATTTTCCCCTCCCACTCCCATACTACTAAT
CTCATCAATACAACCCCCGCCCATCCTACCCAGCACACACACACCGCTGCTAACCCCATA
CCCCGAACCAACCAAACCCCAAAGACACCCCCCACAGTTTATGTAGCTTACCTCCTCAAA
GCAATACACTGAAAATGTTTAGACGGGCTCACATCACCCCATAAACAAATAGGTTTGGTC
CTAGCCTTTCTATTAGCTCTTAGTAAGATTACACATGCAAGCATCCCCGTTCCAGTGAGT
TCACCCTCTAAATCACCACGATCAAAAGGAACAAGCATCAAGCACGCAGCAATGCAGCTC
AAAACGCTTAGCCTAGCCACACCCCCACGGGAAACAGCAGTGATTAACCTTTAGCAATAA
ACGAAAGTTTAACTAAGCTATACTAACCCCAGGGTTGGTCAATTTCGTGCCAGCCACCGC
GGTCACACGATTAACCCAAGTCAATAGAAGCCGGCGTAAAGAGTGTTTTAGATCACCCCC
TCCCCAATAAAGCTAAAACTCACCTGAGTTGTAAAAAACT`.replace(/\n/g, '')
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('raw_sorted_duplicates_removed.cram'),
      seqFetch(ref, start, end) {
        return seq.slice(start, end)
      },
      index: new CraiIndex({
        filehandle: testDataFile('raw_sorted_duplicates_removed.cram.crai'),
      }),
    })

    const features = await cram.getRecordsForRange(0, 0, 500)
    let feat
    features.forEach(f => {
      if (f.readName === 'NB500904:194:H3HNVBGXB:1:21110:9045:16767') {
        feat = f
      }
    })

    expect(feat.getReadBases()).toEqual(
      'ATTACAGGCGAACATACTTAATAAAGTGTGTTAATTAATTAATGCTTGTAGTAAATAATAATAACAATTTAATGTCTGCTCAGCCGCTTTCCACACAGACATCATAACAAAAAATTTCCACCAAACCCCCCCCTCCCCCCGCTTCTGGC',
    )
  })
})

describe('cram31', () => {
  it('returns the correct sequence', async () => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('cram31.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('cram31.cram.crai'),
      }),
    })

    const [feature] = await cram.getRecordsForRange(0, 0, 4)

    expect(feature).toMatchSnapshot()
  })
})

test('start of chr', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('volvox-long-reads-sv.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('volvox-long-reads-sv.cram.crai'),
    }),
  })

  const feats = await cram.getRecordsForRange(0, 0, 1)
  expect(feats.length).toBe(13)
})
