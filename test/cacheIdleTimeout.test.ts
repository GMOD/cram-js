import { expect, test, vi } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

// The record budget is enforced when a decode settles, so it does nothing for a
// consumer sitting still. jbrowse's CramAdapter memoizes one IndexedCramFile
// for the life of the track, so without an idle timeout a tab parked on a
// region holds its whole last view until the track is closed, times every open
// track. 'batch' makes it worse, being the policy least inclined to give
// anything back on its own.
//
// These go through IndexedCramFile rather than CramFile because that is what a
// consumer actually constructs — the option is no use if it stops at the inner
// class.
function open(cacheIdleTimeoutMs?: number) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile('ce#5.tmp.cram'),
    index: new CraiIndex({ filehandle: testDataFile('ce#5.tmp.cram.crai') }),
    fetchReferenceSequence: async (_seqId, start, end) =>
      'A'.repeat(end - start),
    cacheIdleTimeoutMs,
  })
}

test('a slice nothing has looked at for the idle timeout is dropped', async () => {
  vi.useFakeTimers()
  try {
    const cram = open(60_000)
    await cram.getRecordsForRange(0, 10000, 20000)
    expect(cram.cram.featureCache.size).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(cram.cram.featureCache.size).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(cram.cram.featureCache.size).toBe(0)
    expect(cram.cram.featureCache.totalSize).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('re-reading a slice keeps it alive past the idle timeout', async () => {
  vi.useFakeTimers()
  try {
    const cram = open(60_000)
    await cram.getRecordsForRange(0, 10000, 20000)
    const held = cram.cram.featureCache.size

    // 160s of elapsed time against a 60s timeout, and nothing expires: the
    // clock runs from the last read, not from the decode
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(40_000)
      await cram.getRecordsForRange(0, 10000, 20000)
    }
    expect(cram.cram.featureCache.size).toBe(held)
  } finally {
    vi.useRealTimers()
  }
})

test('cacheIdleTimeoutMs: 0 keeps slices until the budget evicts them', async () => {
  vi.useFakeTimers()
  try {
    const cram = open(0)
    await cram.getRecordsForRange(0, 10000, 20000)
    const held = cram.cram.featureCache.size
    expect(held).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(cram.cram.featureCache.size).toBe(held)
  } finally {
    vi.useRealTimers()
  }
})

// The idle timeout reclaims a view the user wandered away from; a consumer that
// knows it is done — a closed track — should not have to wait it out. bam has
// had clearFeatureCache since before the cache was shared; cram had no explicit
// release at all.
test('clearFeatureCache drops everything, and stops the sweep', async () => {
  vi.useFakeTimers()
  try {
    const cram = open(60_000)
    await cram.getRecordsForRange(0, 10000, 20000)
    expect(cram.cram.featureCache.size).toBeGreaterThan(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    cram.clearFeatureCache()
    expect(cram.cram.featureCache.size).toBe(0)
    expect(cram.cram.featureCache.totalSize).toBe(0)
    // an emptied cache must not leave a timer ticking over nothing
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
