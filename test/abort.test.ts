import { expect, test } from 'vitest'

import GatedFile, { drainMicrotasks } from './lib/gatedFile.ts'
import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const CRAM = 'ce#1000.tmp.cram'
const REGION = [0, 0, 200] as const

function openCram(
  cramFile: GenericFilehandle = testDataFile(CRAM),
  craiFile: GenericFilehandle = testDataFile(`${CRAM}.crai`),
) {
  return new IndexedCramFile({
    cramFilehandle: cramFile,
    index: new CraiIndex({ filehandle: craiFile }),
  })
}

/**
 * Warm the reads that are shared file-wide and deliberately not cancellable —
 * the file definition, the SAM header, and the parsed `.crai` — so that what a
 * test gates afterwards is only the per-query slice data.
 */
async function warmUp(cram: IndexedCramFile, file?: GatedFile) {
  await cram.cram.getSamHeader()
  await cram.hasDataForReferenceSequence(0)
  file?.reset()
}

test('a query with an already-aborted signal rejects and reads nothing', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  const controller = new AbortController()
  controller.abort()

  await expect(
    cram.getRecordsForRange(...REGION, { signal: controller.signal }),
  ).rejects.toThrow(/abort/i)
  expect(file.reads).toHaveLength(0)
})

test('aborting mid-query abandons the read in flight', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)

  const controller = new AbortController()
  file.hold()
  const records = cram.getRecordsForRange(...REGION, {
    signal: controller.signal,
  })
  await file.waitForReads(1)
  controller.abort()

  await expect(records).rejects.toThrow(/abort/i)
  // the signal reached the filehandle rather than only being checked between
  // reads — which is what tears down an in-flight range request on RemoteFile
  expect(file.abortedReads).toBeGreaterThan(0)
})

test('a cancelled query does not fail a concurrent one sharing its slice', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)
  const expected = await openCram().getRecordsForRange(...REGION)

  const cancelled = new AbortController()
  file.hold()
  // `cancelled` starts the decode and registers it in the slice record cache;
  // `bystander` reaches the same cache key and joins it rather than reading
  const first = cram.getRecordsForRange(...REGION, {
    signal: cancelled.signal,
  })
  const bystander = new AbortController()
  const second = cram.getRecordsForRange(...REGION, {
    signal: bystander.signal,
  })
  await drainMicrotasks()

  cancelled.abort()
  file.open()

  await expect(first).rejects.toThrow(/abort/i)
  // the bystander inherited nothing: it retried under its own signal and got
  // the same records a query that was never cancelled gets
  const records = await second
  expect(records.map(r => r.uniqueId)).toEqual(expected.map(r => r.uniqueId))
  expect(records).toHaveLength(expected.length)
})

test('a query that aborts itself while joined to another still rejects', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)

  const owner = new AbortController()
  const joiner = new AbortController()
  file.hold()
  const first = cram.getRecordsForRange(...REGION, { signal: owner.signal })
  const second = cram.getRecordsForRange(...REGION, { signal: joiner.signal })
  await drainMicrotasks()

  // both give up. the retry is for inheriting *someone else's* cancellation,
  // so it must not turn the joiner's own abort into a successful read
  owner.abort()
  joiner.abort()
  file.open()

  await expect(first).rejects.toThrow(/abort/i)
  await expect(second).rejects.toThrow(/abort/i)
})

test('a cancelled query does not make a bystander re-read the slice', async () => {
  // baseline: what one query that nobody cancels costs
  const solo = new GatedFile(testDataFile(CRAM))
  const soloCram = openCram(solo)
  await warmUp(soloCram, solo)
  await soloCram.getRecordsForRange(...REGION)
  const soloReads = solo.reads.length

  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)

  const cancelled = new AbortController()
  const bystander = new AbortController()
  file.hold()
  const first = cram.getRecordsForRange(...REGION, { signal: cancelled.signal })
  const second = cram.getRecordsForRange(...REGION, { signal: bystander.signal })
  const firstRejected = expect(first).rejects.toThrow(/abort/i)
  await drainMicrotasks()

  cancelled.abort()
  file.open()
  await firstRejected
  await second

  // The decode is ref-counted, so one of two consumers cancelling is not a
  // cancellation at all — it keeps running for the other. No read is abandoned,
  // and the bystander, which used to inherit the failure and start every slice
  // over, costs exactly what it would have on its own.
  expect(file.abortedReads).toBe(0)
  expect(file.reads.length).toBe(soloReads)
})

test('a cancelled query does not fail a concurrent one sharing the index parse', async () => {
  const crai = new GatedFile(testDataFile(`${CRAM}.crai`))
  const cram = openCram(testDataFile(CRAM), crai)
  const expected = await openCram().getRecordsForRange(...REGION)

  const cancelled = new AbortController()
  const bystander = new AbortController()
  crai.hold()
  // the .crai is downloaded and parsed once and shared by every query, so this
  // is the other place a cancellation could leak between them
  const first = cram.getRecordsForRange(...REGION, {
    signal: cancelled.signal,
  })
  const second = cram.getRecordsForRange(...REGION, {
    signal: bystander.signal,
  })
  await drainMicrotasks()

  cancelled.abort()
  crai.open()

  await expect(first).rejects.toThrow(/abort/i)
  expect((await second).map(r => r.uniqueId)).toEqual(
    expected.map(r => r.uniqueId),
  )
})

test('the reference sequence callback is handed a signal that follows the query', async () => {
  let seen: AbortSignal | undefined
  let releaseFetch!: () => void
  const fetching = new Promise<void>(resolve => {
    releaseFetch = resolve
  })
  const controller = new AbortController()
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(CRAM),
    index: new CraiIndex({ filehandle: testDataFile(`${CRAM}.crai`) }),
    // parks the reference fetch so the test can inspect its signal while the
    // decode it belongs to is genuinely still running
    fetchReferenceSequence: async (_seqId, start, end, _refName, opts) => {
      seen ??= opts?.signal
      await fetching
      return 'N'.repeat(end - start)
    },
  })

  const records = cram.getRecordsForRange(...REGION, {
    signal: controller.signal,
  })
  const rejected = expect(records).rejects.toThrow(/abort/i)
  for (let i = 0; seen === undefined && i < 100; i++) {
    await drainMicrotasks()
  }

  // Not `controller.signal` itself: the decode a reference fetch belongs to is
  // shared between queries, so it runs under the cache's aggregated signal.
  // What the callback is promised is a signal that aborts once everyone waiting
  // on that decode has given up — here, one caller.
  expect(seen).toBeDefined()
  expect(seen!).not.toBe(controller.signal)
  expect(seen!.aborted).toBe(false)
  controller.abort()
  expect(seen!.aborted).toBe(true)

  releaseFetch()
  await rejected
})

test('a signal-free query is unaffected by a cancelled one', async () => {
  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)
  const expected = await openCram().getRecordsForRange(...REGION)

  const cancelled = new AbortController()
  file.hold()
  const first = cram.getRecordsForRange(...REGION, {
    signal: cancelled.signal,
  })
  const second = cram.getRecordsForRange(...REGION)
  await drainMicrotasks()

  cancelled.abort()
  file.open()

  await expect(first).rejects.toThrow(/abort/i)
  expect((await second).map(r => r.uniqueId)).toEqual(
    expected.map(r => r.uniqueId),
  )
})
