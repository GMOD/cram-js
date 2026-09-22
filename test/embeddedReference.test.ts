import { describe, expect, test } from 'vitest'

import { CraiIndex, CramFile, IndexedCramFile } from '../src/index.ts'
import { allRecords, dumpWholeFile } from './lib/dumpFile.ts'
import {
  alignments,
  qualString,
  samFields,
  samtoolsAvailable,
} from './lib/samtools.ts'
import { testDataFile } from './lib/util.ts'

import type { CramRecord, SeqFetch } from '../src/index.ts'

// Each written from its .sam_ by `samtools view -C --output-fmt-option
// embed_ref=1`, so every slice carries the reference it was encoded against and
// samtools decodes it with none supplied. The .sam_ header names the FASTA for
// anyone regenerating it; nothing here reads it.
const NAME = 'embedref#embedded.tmp.cram'

// overhang#end with the reference embedded: three 100M reads on a 1000 bp
// contig, the last two overhanging its end. htslib stops the slice's declared
// span, and so the embedded block, at the end of the contig.
const OVERHANG = 'overhang#embedded.tmp.cram'

// The hts-specs fixtures that embed their reference. Their snapshots once
// recorded no bases for any of their 131,758 mapped reads, so they are held to
// samtools here rather than only to themselves.
const HTS_SPECS = [
  'cram/3.0/passed/0600_mapped.cram',
  'cram/3.0/passed/0601_mapped.cram',
  'cram/3.0/passed/level-1.cram',
  'cram/3.0/passed/level-2.cram',
  'cram/3.0/passed/level-4.cram',
  'cram/3.1/passed/level-1.cram',
  'cram/3.1/passed/level-2.cram',
  'cram/3.1/passed/level-3.cram',
  'cram/3.1/passed/level-4.cram',
].map(f => `hts-specs/${f}`)

function open(
  opts: {
    fetchReferenceSequence?: SeqFetch
    checkSequenceMD5?: boolean
  },
  name = NAME,
) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(name),
    index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
    useSliceWorkerPool: false,
    ...opts,
  })
}

function decoded(records: CramRecord[]) {
  return records
    .map(r =>
      samFields([
        r.readName,
        r.flags,
        r.start + 1,
        r.getCigarString(),
        r.mappingQuality ?? 0,
        r.templateLength ?? r.templateSize ?? 0,
        r.getReadBases(),
        qualString(r.qualityScores),
      ]),
    )
    .sort()
}

describe.skipIf(!samtoolsAvailable())('an embedded reference', () => {
  const expected = () => alignments(`test/data/${NAME}`, 'embedchr')

  test.each([false, true])(
    'decodes with no callback at all (checkSequenceMD5: %s)',
    async checkSequenceMD5 => {
      const records = await open({ checkSequenceMD5 }).getRecordsForRange(
        0,
        0,
        3000,
      )
      expect(records.filter(r => !r.isSegmentUnmapped()).length).toBe(6)
      expect(decoded(records)).toEqual(expected())
    },
  )

  test('wins over the callback', async () => {
    const calls: [number, number][] = []
    const cram = open({
      fetchReferenceSequence: async (_id, start, end) => {
        calls.push([start, end])
        return 'N'.repeat(end - start)
      },
    })
    // The first query's prefetch leaves before any slice header says the
    // reference is embedded, and waits on the @SQ lines to clamp its request.
    // Reading them first lets it land inside that query instead of the next.
    await cram.cram.getReferenceInfo()

    // every matched base would read N had the callback's answer been used
    expect(decoded(await cram.getRecordsForRange(0, 0, 3000))).toEqual(
      expected(),
    )
    expect(calls).toHaveLength(1)

    // once one slice has said so, the file stops asking
    cram.clearFeatureCache()
    calls.length = 0
    await cram.getRecordsForRange(0, 0, 3000)
    expect(calls).toEqual([])
  })

  // with a callback, every matched base would read A had its answer been used
  test.each([
    ['no callback', undefined],
    [
      'a callback',
      async (_id: number, start: number, end: number) =>
        'A'.repeat(end - start),
    ],
  ])(
    'covers reads overhanging the end of the contig, given %s',
    async (_, fetchReferenceSequence) => {
      const records = await open(
        { fetchReferenceSequence },
        OVERHANG,
      ).getRecordsForRange(0, 0, 1000)
      expect(decoded(records)).toEqual(
        alignments(`test/data/${OVERHANG}`, 'ohchr'),
      )
    },
  )

  test.each(HTS_SPECS)(
    '%s decodes whole as samtools does, neither given a reference',
    async name => {
      const dump = await dumpWholeFile(
        new CramFile({ filehandle: testDataFile(name) }),
      )
      expect(decoded(allRecords(dump))).toEqual(
        alignments(`test/data/${name}`, undefined),
      )
    },
  )
})
