import { expect, test } from 'vitest'

import GatedFile from './lib/gatedFile.ts'
import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

// ce#1000 packs 5 slices into each of its ~30 containers, which is what makes
// it the fixture for this: a query over the whole reference touches every
// container several times over.
const CRAM = 'ce#1000.tmp.cram'

async function readsForWholeReferenceQuery() {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = new IndexedCramFile({
    cramFilehandle: file,
    index: new CraiIndex({ filehandle: testDataFile(`${CRAM}.crai`) }),
  })
  // the definition, SAM header and .crai are read once for the life of the
  // object; count only what the query itself issues
  await cram.cram.getSamHeader()
  await cram.hasDataForReferenceSequence(0)
  file.reset()

  const records = await cram.getRecordsForRange(0, 0, 200)
  return { records, reads: file.reads }
}

test('a range query issues no duplicate reads', async () => {
  const { records, reads } = await readsForWholeReferenceQuery()

  // preconditions, so this cannot pass by fetching nothing: the query has to
  // really span many slices across many containers for the property to mean
  // anything
  expect(records).toHaveLength(1000)
  expect(reads.length).toBeGreaterThan(100)

  // Every slice of a query used to build its own CramContainer, so each
  // container's header and compression header block were re-read once per slice
  // it held — 456 of 1001 reads on this fixture were byte-for-byte repeats of
  // another read in the same query. `getRecordsForRange` now shares containers
  // across the slices of one query (and deliberately no wider than that; see
  // the comment where it builds the map).
  const distinct = new Set(
    reads.map(([length, position]) => `${length}@${position}`),
  )
  expect(distinct.size).toBe(reads.length)
})

test('a range query reads little more than the bytes it needs', async () => {
  const { reads } = await readsForWholeReferenceQuery()
  const bytes = reads.reduce((total, [length]) => total + length, 0)

  // The fixture is 141,134 bytes and the query covers all of it. Before
  // containers were shared this read 200,851 — 1.42x the file. The remaining
  // overhead is the speculative container header read: 221 bytes requested
  // against a header of about 30, once per container.
  expect(bytes).toBeLessThan(141_134 * 1.1)
})
