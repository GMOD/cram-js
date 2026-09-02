import { SharedBudget } from '@gmod/shared-read-cache'
import { expect, test } from 'vitest'

import {
  CraiIndex,
  DEFAULT_MAX_CACHE_BYTES,
  IndexedCramFile,
} from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

// maxCacheBytes is per file, which is no bound at all on a consumer that opens
// one file per open track — jbrowse's CramAdapter memoizes one IndexedCramFile
// for the life of the track. @gmod/bam measured the shape on its own caches: six
// tracks browsing six windows retained 1442MB with every cache still under its
// own ceiling, so the ceiling was not what held the line (its ADR 0018).
//
// Through IndexedCramFile rather than CramFile because that is what a consumer
// constructs — the option is no use if it stops at the inner class.
function open(cacheBudget?: SharedBudget) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile('ce#5.tmp.cram'),
    index: new CraiIndex({ filehandle: testDataFile('ce#5.tmp.cram.crai') }),
    fetchReferenceSequence: async (_seqId, start, end) =>
      'A'.repeat(end - start),
    cacheIdleTimeoutMs: 0,
    cacheBudget,
  })
}

test('two files can share one budget', async () => {
  const budget = new SharedBudget(1 << 20)
  const a = open(budget)
  const b = open(budget)

  await a.getRecordsForRange(0, 10000, 20000)
  await b.getRecordsForRange(0, 10000, 20000)

  // each file still carries the full per-file byte ceiling and is nowhere near
  // it, which is the point: their SUM is what the budget holds
  expect(a.cram.featureCache.maxSize).toBe(DEFAULT_MAX_CACHE_BYTES)
  expect(b.cram.featureCache.maxSize).toBe(DEFAULT_MAX_CACHE_BYTES)
  const held = a.cram.featureCache.totalSize + b.cram.featureCache.totalSize
  expect(held).toBe(budget.total)
  expect(held).toBeLessThanOrEqual(budget.limit)
})

test('without a budget each file is bounded only by its own ceiling', async () => {
  const a = open()
  const b = open()

  await a.getRecordsForRange(0, 10000, 20000)
  await b.getRecordsForRange(0, 10000, 20000)

  // nothing relates the two -- this is the state the budget exists to change
  expect(a.cram.featureCache.totalSize).toBeGreaterThan(0)
  expect(b.cram.featureCache.totalSize).toBeGreaterThan(0)
})

test('clearing a member credits its bytes back', async () => {
  const budget = new SharedBudget(DEFAULT_MAX_CACHE_BYTES)
  const cram = open(budget)

  await cram.getRecordsForRange(0, 10000, 20000)
  expect(budget.total).toBeGreaterThan(0)
  expect(budget.size).toBe(1)

  cram.clearFeatureCache()
  expect(budget.total).toBe(0)
})
