import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

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
