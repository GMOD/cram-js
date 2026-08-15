import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { testDataFile } from './lib/util.ts'
import CramFile from '../src/cramFile/file.ts'
import { isMappedSliceHeader } from '../src/cramFile/sectionParsers.ts'
import { buildSliceDecodeContext } from '../src/cramFile/slice/decodeContext.ts'

// The read-feature arena is sized from the slice's own blocks before a record is
// decoded — FC is one byte per read feature, so an external FC block's length is
// the count. This asserts the arena is created at *exactly* that count, which is
// the whole claim: an arena that starts right never grows (seven column copies
// per doubling) and never trims.
//
// A wall-clock number for it is not asserted here, and the one measured is
// modest — ~5% on a cold ONT slice decode, nothing outside the noise floor on
// short reads, retained heap unchanged. See TODO.md's method note on why timing
// claims from this repo's benchmarks are not to be trusted without care.

const seqFetch = async (_id: number, start: number, end: number) =>
  'A'.repeat(end - start)

async function firstSliceOf(name: string) {
  const index = new CraiIndex({ filehandle: testDataFile(`${name}.crai`) })
  const file = new CramFile({
    filehandle: testDataFile(name),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
    useSliceWorkerPool: false,
  })
  const entry = (await index.getEntriesForRange(0, 0, 1e9))[0]!
  const container = file.getContainerAtPosition(entry.containerStart)
  const slice = container.getSlice(entry.sliceStart, entry.sliceBytes)
  const header = (await slice.getHeader()).parsedContent
  if (!isMappedSliceHeader(header)) {
    throw new Error('expected a mapped slice')
  }
  const compressionScheme = (await container.getCompressionScheme())!
  const { majorVersion } = await file.getDefinition()

  const ctx = buildSliceDecodeContext({
    compressionScheme,
    blocksByContentId: await slice._getBlocksContentIdIndex(),
    coreDataBlock: await slice.getCoreDataBlock(),
    majorVersion,
    refSeqId: header.refSeqId,
    refSeqStart: header.refSeqStart,
    decodeTags: true,
  })

  // a second slice object, so the decode below is not the one the context above
  // has already advanced the cursors of
  const records = await container
    .getSlice(entry.sliceStart, entry.sliceBytes)
    .getAllRecords()
  let features = 0
  for (const r of records) {
    features += r.readFeatureCount
  }
  return { capacity: ctx.arena.codes.length, features, records: records.length }
}

test.each([
  ['HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram', 213602],
  ['SRR396637.sorted.clip.cram', 19849],
  ['SRR396636.sorted.clip.cram', 16156],
  ['ce#1000.tmp.cram', 12],
])('%s: the arena is built at the exact feature count', async (name, count) => {
  const { capacity, features } = await firstSliceOf(name)
  expect(features).toBe(count)
  expect(capacity).toBe(features)
})
