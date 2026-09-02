// The reference used to be fetched strictly after a slice was decoded, because
// the span to ask for came from the decoded records. The declared span is
// known from the index before the slice is read, so the fetch now starts first
// and the decode joins it. This pins both halves: that the fetch is in flight
// while the slice's own read is still parked, and that a slice whose declared
// span covers its reads fetches exactly once.
import { expect, test } from 'vitest'

import GatedFile, { drainMicrotasks } from './lib/gatedFile.ts'
import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

const CRAM = 'ce#1000.tmp.cram'

test('the reference fetch starts before the slice bytes arrive', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const fetches: [number, number, number][] = []
  const cram = new IndexedCramFile({
    cramFilehandle: file,
    index: new CraiIndex({ filehandle: testDataFile(`${CRAM}.crai`) }),
    fetchReferenceSequence: async (seqId, start, end) => {
      fetches.push([seqId, start, end])
      return 'A'.repeat(end - start)
    },
  })
  await cram.cram.getSamHeader()
  const slices = await cram.index.getEntriesForRange(0, 0, 200)
  expect(slices.length).toBeGreaterThan(1)
  file.reset()

  file.hold()
  const records = cram.getRecordsForRange(0, 0, 200)
  // the first container header read is parked, so nothing has been decoded —
  // and every slice has already asked for its reference
  await file.waitForReads(1)
  await drainMicrotasks()
  expect(fetches).toHaveLength(slices.length)
  file.open()

  expect(await records).toHaveLength(1000)
  // the declared span covered every read, so no second, exact fetch followed
  expect(fetches).toHaveLength(slices.length)
  expect(fetches.map(f => [f[1], f[2]])).toEqual(
    slices.map(s => [s.start, s.start + s.span]),
  )
})

test('a fetch that fails ahead of time is retried exactly after the decode', async () => {
  const calls: number[] = []
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(CRAM),
    index: new CraiIndex({ filehandle: testDataFile(`${CRAM}.crai`) }),
    fetchReferenceSequence: async (_seqId, start, end) => {
      calls.push(start)
      if (calls.length === 1) {
        throw new Error('transient')
      }
      return 'A'.repeat(end - start)
    },
  })
  const first = (await cram.index.getEntriesForRange(0, 0, 1e9))[0]!
  const slices = await cram.index.getEntriesForRange(
    0,
    first.start,
    first.start + 1,
  )
  expect(slices).toHaveLength(1)
  const records = await cram.getRecordsForRange(0, first.start, first.start + 1)
  expect(records.length).toBeGreaterThan(0)
  expect(calls).toEqual([slices[0]!.start, slices[0]!.start])
  expect(records[0]!.getReadBases()).toBeDefined()
})
