import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type { CramRecord } from '../src/index.ts'

// ce#tag_padded.tmp.cram carries PT aux tags on some of its records
function openCram() {
  return new IndexedCramFile({
    cramFilehandle: testDataFile('ce#tag_padded.tmp.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('ce#tag_padded.tmp.cram.crai'),
    }),
  })
}

const tagged = (records: { tags: Record<string, unknown> }[]) =>
  records.filter(r => Object.keys(r.tags).length > 0)

// Regression guard: DecodeOptions defaults used to be applied by spreading
// `{...defaultDecodeOptions, ...decodeOptions}`, but IndexedCramFile builds a
// DecodeOptions with an explicitly-undefined decodeTags, and a spread lets that
// undefined overwrite the default. Tags stayed decoded only because the
// consumer compared `decodeTags !== false` rather than reading it as a boolean.
test('tags are decoded by default through getRecordsForRange', async () => {
  const records = await openCram().getRecordsForRange(0, 0, 100_000)
  expect(records.length).toBeGreaterThan(0)
  expect(tagged(records).length).toBeGreaterThan(0)
  expect(tagged(records)[0]!.tags).toHaveProperty('PT')
})

test('decodeTags: true is equivalent to the default', async () => {
  const records = await openCram().getRecordsForRange(0, 0, 100_000, {
    decodeTags: true,
  })
  expect(tagged(records).length).toBeGreaterThan(0)
})

test('decodeTags: false leaves tags undecoded', async () => {
  const records = await openCram().getRecordsForRange(0, 0, 100_000, {
    decodeTags: false,
  })
  expect(records.length).toBeGreaterThan(0)
  expect(tagged(records)).toHaveLength(0)
})

// viewAsPairs fetches the slices a query's unmated reads point into, and those
// records were decoded with `{ signal }` alone rather than the query's options.
// So the mates came back carrying tags a caller had asked not to decode — and
// since decodeTags is part of the slice cache key, a slice already decoded above
// was decoded and cached a second time under the other key.
test('decodeTags: false reaches the mates viewAsPairs pulls in', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('paired.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('paired.cram.crai'),
    }),
  })
  const plain = await cram.getRecordsForRange(19, 62500, 64500, {
    decodeTags: false,
  })
  const withMates = await cram.getRecordsForRange(19, 62500, 64500, {
    viewAsPairs: true,
    decodeTags: false,
  })

  // the mates are really being fetched, or this asserts nothing
  expect(withMates.length).toBeGreaterThan(plain.length)
  expect(tagged(withMates)).toHaveLength(0)
})

// the slice record cache keys on the decode options, so the two configurations
// must not bleed into each other within one file
test('decodeTags variants do not share a cache entry', async () => {
  const cram = openCram()
  const withoutTags = await cram.getRecordsForRange(0, 0, 100_000, {
    decodeTags: false,
  })
  const withTags = await cram.getRecordsForRange(0, 0, 100_000)

  expect(withoutTags.length).toBe(withTags.length)
  expect(tagged(withoutTags)).toHaveLength(0)
  expect(tagged(withTags).length).toBeGreaterThan(0)
})

// htsjdk wrote this file with the lengths of its OC and XA tags in the core
// bit-stream, so skipping those reads left every later record decoding from the
// wrong bit: the first slice ran off its core block after 1,718 of its 10,000
// records. The file is a partial download, so the query stays inside that slice.
test('decodeTags: false decodes a file whose tags read the core block', async () => {
  const name =
    'grc37-1#HG03297.mapped.ILLUMINA.bwa.ESN.low_coverage.20130415.bam.cram'
  const query = (decodeTags: boolean) =>
    new IndexedCramFile({
      cramFilehandle: testDataFile(name),
      index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
      fetchReferenceSequence: async (_seqId, start, end) =>
        'A'.repeat(end - start),
    }).getRecordsForRange(0, 9993, 79674, { decodeTags })
  const withTags = await query(true)
  const withoutTags = await query(false)

  const fields = (r: CramRecord) =>
    [
      r.readName,
      r.flags,
      r.cramFlags,
      r.sequenceId,
      r.start,
      r.readLength,
      r.getCigarString(),
      r.mappingQuality,
      r.templateLength ?? r.templateSize,
      r.nextSequenceId,
      r.nextStart,
      r.getReadBases(),
      r.qualityScores?.join(','),
    ].join('|')

  expect(withTags).toHaveLength(10_000)
  expect(withTags.some(r => r.getTag('XA') !== undefined)).toBe(true)
  expect(withoutTags.map(fields)).toEqual(withTags.map(fields))
  expect(tagged(withoutTags)).toHaveLength(0)
})
