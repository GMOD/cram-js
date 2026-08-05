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

test('containers and slices are never shared between queries', () => {
  const { cram } = openCram()

  // Not a style preference — this is the invariant the whole signal-threading
  // arrangement rests on. Container and slice memos take the caller's signal on
  // a first-caller-wins basis (see `memoizeAsync`), which is sound only while
  // every caller of one memo belongs to the same query. Cache either of these
  // objects file-wide and the first query to arrive silently owns a header that
  // every later query depends on, which is the leak `SliceRecordCache` and
  // `CraiIndex` handle explicitly, reappearing somewhere that does not.
  //
  // Nothing else in the suite would notice: the tests below all pass against a
  // file-level container cache. Hence this one.
  const container = cram.getContainerAtPosition(0)
  expect(cram.getContainerAtPosition(0)).not.toBe(container)
  expect(container.getSlice(0, 100)).not.toBe(container.getSlice(0, 100))
})

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

/** how many times each byte offset was read */
function readsByPosition(reads: [number, number][]) {
  const counts = new Map<number, number>()
  for (const [, position] of reads) {
    counts.set(position, (counts.get(position) ?? 0) + 1)
  }
  return counts
}

test('a pan does not make the new view re-decode the slices it shares', async () => {
  // The motivating case, in its real shape: the user pans, the query in flight
  // is cancelled, and the new view wants an overlapping — not identical — set
  // of slices. The ones still decoding are exactly the ones both queries want.
  const LEAVING = [0, 0, 60] as const
  const ARRIVING = [0, 40, 200] as const

  // Baseline: the same two regions, in the same order, nobody cancelled. The
  // second query finds the shared slices in the record cache, so every slice is
  // decoded once and each byte offset is read the fewest times it can be.
  const solo = new GatedFile(testDataFile(CRAM))
  const soloCram = openCram(solo)
  await warmUp(soloCram, solo)
  await soloCram.getRecordsForRange(...LEAVING)
  const expected = await soloCram.getRecordsForRange(...ARRIVING)
  const baseline = readsByPosition(solo.reads)
  const baselineReads = solo.reads.length

  const file = new GatedFile(testDataFile(CRAM))
  const cram = openCram(file)
  await warmUp(cram, file)

  const cancelled = new AbortController()
  const arriving = new AbortController()
  file.hold()
  const leaving = cram.getRecordsForRange(...LEAVING, {
    signal: cancelled.signal,
  })
  const records = cram.getRecordsForRange(...ARRIVING, {
    signal: arriving.signal,
  })
  const leavingRejected = expect(leaving).rejects.toThrow(/abort/i)
  await drainMicrotasks()

  cancelled.abort()
  file.open()
  await leavingRejected
  const arrived = await records

  // The property. A slice both queries want is decoded once: the cancellation
  // does not reach it, because the arriving query still wants it. Under the
  // retry this replaced, every shared slice still in flight was read a second
  // time — so its offset would be read once more here than in the baseline,
  // where it was read once and then served from the cache.
  //
  // Stated as "no more than", not "equal to", because the leaving query's
  // *exclusive* slices are genuinely cancelled and stop part-read — those
  // offsets are legitimately read fewer times than the baseline.
  for (const [position, count] of readsByPosition(file.reads)) {
    expect(count).toBeLessThanOrEqual(baseline.get(position) ?? 0)
  }
  expect(arrived.map(r => r.uniqueId)).toEqual(expected.map(r => r.uniqueId))

  // On this fixture the bound is in fact tight. Slices here span ~100 bp on a
  // ~180 bp reference, so every slice the leaving view wanted is one the
  // arriving view wants too — nothing is cancelled early, and a cancelled pan
  // costs exactly what the same two views cost with no cancellation at all.
  // The per-offset form above is what generalizes to a file whose slices are
  // short enough for the leaving view to have some of its own.
  expect(file.reads.length).toBe(baselineReads)

  // Not vacuous: the two views really do want different slices, and really do
  // share most of them — run independently they would cost far more than the
  // baseline, which is the sharing this test is about.
  const readsAlone = async (region: readonly [number, number, number]) => {
    const alone = new GatedFile(testDataFile(CRAM))
    const aloneCram = openCram(alone)
    await warmUp(aloneCram, alone)
    await aloneCram.getRecordsForRange(region[0], region[1], region[2])
    return alone.reads.length
  }
  const [leavingAlone, arrivingAlone] = await Promise.all([
    readsAlone(LEAVING),
    readsAlone(ARRIVING),
  ])
  expect(arrived.length).toBeGreaterThan(0)
  expect(baselineReads).toBeLessThan(leavingAlone + arrivingAlone)
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
