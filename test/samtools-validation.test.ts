import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { references } from './lib/samtools.ts'
import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

function dataPath(filename: string) {
  return path.join(process.cwd(), 'test', 'data', filename)
}

function getSamtoolsCount(filename: string, region?: string): number {
  const args = ['view', '-c', dataPath(filename)]
  if (region) {
    args.push(region)
  }
  try {
    return Number.parseInt(
      execFileSync('samtools', args, {
        encoding: 'utf8',
        // as in ./lib/samtools.ts: without this htslib reaches for the EBI
        // registry for any reference it cannot find on disk
        env: {
          ...process.env,
          REF_PATH: process.env.REF_PATH ?? 'test/data/%s',
        },
      }).trim(),
      10,
    )
  } catch (error) {
    throw new Error(`Failed to run samtools view -c on ${filename}`, {
      cause: error,
    })
  }
}

/**
 * Reference names in header order.
 *
 * Empty only for a file with no @SQ lines. This used to swallow the read
 * failing too, which the callers below read as "nothing to check" and passed.
 */
function getRefNames(filename: string): string[] {
  const refs = references(dataPath(filename))
  if (!refs) {
    throw new Error(`samtools could not read ${filename}`)
  }
  return refs.map(r => r.name)
}

describe('CRAM record count validation against samtools', () => {
  const testFiles = [
    'auxf#values.tmp.cram',
    'c1#bounds.tmp.cram',
    'c1#clip.tmp.cram',
    'c1#pad1.tmp.cram',
    'c1#pad2.tmp.cram',
    'c1#pad3.tmp.cram',
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
  ]

  // Files excluded from this validation:
  // - c1#noseq.tmp.cram: Records with no sequence data have special handling
  // - c1#unknown.tmp.cram: Contains records with unknown reference behavior
  // - ce#unmap.tmp.cram, ce#unmap1.tmp.cram, ce#unmap2.tmp.cram: Unmapped-only files with no @SQ lines
  // - xx#unsorted.tmp.cram: Unsorted records may not be correctly handled by index-based queries
  // These edge cases are covered by the snapshot tests

  testFiles.forEach(filename => {
    describe(filename, () => {
      it('whole file record count matches samtools', async () => {
        const cram = new IndexedCramFile({
          cramFilehandle: testDataFile(filename),
          index: new CraiIndex({
            filehandle: testDataFile(`${filename}.crai`),
          }),
        })

        const samHeader = await cram.cram.getSamHeader()
        const sqLines = samHeader.filter(l => l.tag === 'SQ')

        let allFeatures: Awaited<ReturnType<typeof cram.getRecordsForRange>> =
          []
        for (let refId = 0; refId < sqLines.length; refId++) {
          const features = await cram.getRecordsForRange(
            refId,
            -1,
            Number.POSITIVE_INFINITY,
          )
          allFeatures = allFeatures.concat(features)
        }

        const unmappedFeatures = await cram.getRecordsForRange(
          -1,
          -1,
          Number.POSITIVE_INFINITY,
        )
        allFeatures = allFeatures.concat(unmappedFeatures)

        const samtoolsCount = getSamtoolsCount(filename)

        expect(allFeatures.length).toEqual(samtoolsCount)
      })

      it('first reference sequence record count matches samtools', async () => {
        const refNames = getRefNames(filename)
        if (refNames.length === 0) {
          return
        }

        const cram = new IndexedCramFile({
          cramFilehandle: testDataFile(filename),
          index: new CraiIndex({
            filehandle: testDataFile(`${filename}.crai`),
          }),
        })

        const features = await cram.getRecordsForRange(
          0,
          -1,
          Number.POSITIVE_INFINITY,
        )
        const samtoolsCount = getSamtoolsCount(filename, refNames[0])

        expect(features.length).toEqual(samtoolsCount)
      })

      it('second reference sequence record count matches samtools', async () => {
        const refNames = getRefNames(filename)
        if (refNames.length < 2) {
          return
        }

        const cram = new IndexedCramFile({
          cramFilehandle: testDataFile(filename),
          index: new CraiIndex({
            filehandle: testDataFile(`${filename}.crai`),
          }),
        })

        const features = await cram.getRecordsForRange(
          1,
          -1,
          Number.POSITIVE_INFINITY,
        )
        const samtoolsCount = getSamtoolsCount(filename, refNames[1])

        expect(features.length).toEqual(samtoolsCount)
      })
    })
  })

  describe('files with specific regions', () => {
    it('SRR396636.sorted.clip.cram region 25999-26499', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 25999, 26499)
      const refNames = getRefNames('SRR396636.sorted.clip.cram')
      const samtoolsCount = getSamtoolsCount(
        'SRR396636.sorted.clip.cram',
        `${refNames[0]}:${25999 + 1}-26499`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('SRR396637.sorted.clip.cram region 163504-175473', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('SRR396637.sorted.clip.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('SRR396637.sorted.clip.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 163504, 175473)
      const refNames = getRefNames('SRR396637.sorted.clip.cram')
      const samtoolsCount = getSamtoolsCount(
        'SRR396637.sorted.clip.cram',
        `${refNames[0]}:${163504 + 1}-175473`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram first ref', async () => {
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

      const features = await cram.getRecordsForRange(
        0,
        -1,
        Number.POSITIVE_INFINITY,
      )
      const file = 'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram'
      const refNames = getRefNames(file)
      const samtoolsCount = getSamtoolsCount(file, refNames[0])

      expect(features.length).toEqual(samtoolsCount)
    })

    it('paired.cram region chr20:62501-64500 without viewAsPairs', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('paired.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('paired.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(19, 62501, 64500)

      const refNames = getRefNames('paired.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'paired.cram',
        `${refNames[19]}:${62501 + 1}-64500`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('long_pair.cram region 15767-28287', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('long_pair.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('long_pair.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      // Note: using viewAsPairs may fetch additional mate records
      const features = await cram.getRecordsForRange(0, 15767, 28287, {
        viewAsPairs: true,
      })

      const refNames = getRefNames('long_pair.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'long_pair.cram',
        `${refNames[0]}:${15767 + 1}-28287`,
      )

      // viewAsPairs fetches mate records, so count may be >= samtools count
      expect(features.length).toBeGreaterThanOrEqual(samtoolsCount)
    })

    it('raw_sorted_duplicates_removed.cram region 0-500', async () => {
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
TCCCCAATAAAGCTAAAACTCACCTGAGTTGTAAAAAACT`.replaceAll('\n', '')
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('raw_sorted_duplicates_removed.cram'),
        async fetchReferenceSequence(ref, start, end) {
          return seq.slice(start, end)
        },
        index: new CraiIndex({
          filehandle: testDataFile('raw_sorted_duplicates_removed.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 0, 500)
      const refNames = getRefNames('raw_sorted_duplicates_removed.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'raw_sorted_duplicates_removed.cram',
        `${refNames[0]}:${0 + 1}-500`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('cram31.cram region 0-4', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('cram31.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('cram31.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 0, 4)
      const refNames = getRefNames('cram31.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'cram31.cram',
        `${refNames[0]}:${0 + 1}-4`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('volvox-long-reads-sv.cram region 0-1', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('volvox-long-reads-sv.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('volvox-long-reads-sv.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 0, 1)
      const refNames = getRefNames('volvox-long-reads-sv.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'volvox-long-reads-sv.cram',
        `${refNames[0]}:${0 + 1}-1`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('ce#tag_padded.tmp.cram first ref', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('ce#tag_padded.tmp.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('ce#tag_padded.tmp.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 2, 200)
      const refNames = getRefNames('ce#tag_padded.tmp.cram')
      const samtoolsCount = getSamtoolsCount(
        'ce#tag_padded.tmp.cram',
        `${refNames[0]}:${2 + 1}-200`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })
  })

  describe('archive tests', () => {
    it('igv-js-bug/archived.cram chr9', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('igv-js-bug/archived.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('igv-js-bug/archived.cram.crai'),
        }),
      })
      const samHeader = await cram.cram.getSamHeader()

      const nameToId: Record<string, number> = {}
      const sqLines = samHeader.filter(l => l.tag === 'SQ')
      sqLines.forEach((sqLine, refId) => {
        sqLine.data.forEach(item => {
          if (item.tag === 'SN') {
            const refName = item.value
            nameToId[refName] = refId
          }
        })
      })

      const feats = await cram.getRecordsForRange(nameToId.chr9, 0, 200000000)
      const samtoolsCount = getSamtoolsCount('igv-js-bug/archived.cram', 'chr9')

      expect(feats.length).toEqual(samtoolsCount)
    })

    it('igv-js-bug/normal.cram chr9', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('igv-js-bug/normal.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('igv-js-bug/normal.cram.crai'),
        }),
      })
      const samHeader = await cram.cram.getSamHeader()

      const nameToId: Record<string, number> = {}
      const sqLines = samHeader.filter(l => l.tag === 'SQ')
      sqLines.forEach((sqLine, refId) => {
        sqLine.data.forEach(item => {
          if (item.tag === 'SN') {
            const refName = item.value
            nameToId[refName] = refId
          }
        })
      })

      const feats = await cram.getRecordsForRange(nameToId.chr9, 0, 200000000)
      const samtoolsCount = getSamtoolsCount('igv-js-bug/normal.cram', 'chr9')

      expect(feats.length).toEqual(samtoolsCount)
    })
  })

  describe('lossy names test', () => {
    it('na12889_lossy.cram region 155140000-155160000', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('na12889_lossy.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('na12889_lossy.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(0, 155140000, 155160000)
      const refNames = getRefNames('na12889_lossy.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'na12889_lossy.cram',
        `${refNames[0]}:${155140000 + 1}-155160000`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })

    it('na12889_lossy.cram region chr16:12100200-12100300', async () => {
      const cram = new IndexedCramFile({
        cramFilehandle: testDataFile('na12889_lossy.cram'),
        index: new CraiIndex({
          filehandle: testDataFile('na12889_lossy.cram.crai'),
        }),
      })

      // getRecordsForRange uses 0-based coordinates
      const features = await cram.getRecordsForRange(1, 12100200, 12100300)
      const refNames = getRefNames('na12889_lossy.cram')
      // samtools uses 1-based coordinates, so add 1 to start
      const samtoolsCount = getSamtoolsCount(
        'na12889_lossy.cram',
        `${refNames[1]}:${12100200 + 1}-12100300`,
      )

      expect(features.length).toEqual(samtoolsCount)
    })
  })
})
