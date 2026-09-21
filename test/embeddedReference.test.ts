import { describe, expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import {
  alignments,
  qualString,
  samFields,
  samtoolsAvailable,
} from './lib/samtools.ts'
import { testDataFile } from './lib/util.ts'

import type { CramRecord, SeqFetch } from '../src/index.ts'

// Written from its .sam_ by `samtools view -C --output-fmt-option embed_ref=1`,
// so every slice carries the reference it was encoded against and samtools
// decodes it with none supplied. The .sam_ header names embedref.fa for anyone
// regenerating it; nothing here reads that FASTA.
const NAME = 'embedref#embedded.tmp.cram'

function open(opts: {
  fetchReferenceSequence?: SeqFetch
  checkSequenceMD5?: boolean
}) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(NAME),
    index: new CraiIndex({ filehandle: testDataFile(`${NAME}.crai`) }),
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
})
