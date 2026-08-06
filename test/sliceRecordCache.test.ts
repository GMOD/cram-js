import { SharedReadCache } from '@gmod/shared-read-cache'
import { expect, test } from 'vitest'

import type CramRecord from '../src/cramFile/record.ts'

/**
 * The cache exactly as CramFile configures it -- records as the unit, and the
 * batch eviction policy. The cancellation behaviour these tests cover lives in
 * @gmod/shared-read-cache and is tested there too; what is checked here is that
 * cram's configuration of it still behaves the way cram needs.
 */
const makeCache = (maxRecords: number) =>
  new SharedReadCache<string, CramRecord[]>({
    maxSize: maxRecords,
    sizeOf: records => records.length,
    evictionPolicy: 'batch',
  })

// the cache only ever reads `.length` off the resolved array
const records = (n: number) =>
  Promise.resolve(new Array(n).fill(null) as unknown as CramRecord[])

/**
 * Put `promise` in the cache under `key` and hand it back.
 *
 * `getOrFill` returns a chain of its own — the one that reports *this* caller's
 * cancellation — while these tests assert on the cached promise, so the
 * caller's chain is settled here and discarded. Tests about what a caller sees
 * are further down.
 */
function fill(
  cache: SharedReadCache<string, CramRecord[]>,
  key: string,
  promise: Promise<CramRecord[]>,
) {
  void cache.get(key, undefined, () => promise).catch(() => undefined)
  return promise
}

/** a promise the test settles by hand, plus the signal its fill was given */
function deferred() {
  let resolve!: (records: CramRecord[]) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<CramRecord[]>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('serves a cached slice back', async () => {
  const cache = makeCache(100)
  const p = fill(cache, 'a', records(10))
  await p
  expect(cache.getIfCached('a')).toBe(p)
  expect(cache.getIfCached('missing')).toBeUndefined()
})

test('bounds by record count, not by number of slices', async () => {
  const cache = makeCache(100)
  // three slices of 40 records: the third must push the first out, even though
  // an entry-counting cache would happily hold all three
  for (const key of ['a', 'b', 'c']) {
    await fill(cache, key, records(40))
  }
  expect(cache.getIfCached('a')).toBeUndefined()
  expect(cache.getIfCached('b')).toBeDefined()
  expect(cache.getIfCached('c')).toBeDefined()
})

test('evicts least recently used', async () => {
  const cache = makeCache(100)
  for (const key of ['a', 'b']) {
    await fill(cache, key, records(40))
  }
  // touch 'a' so 'b' becomes the least recently used
  void cache.getIfCached('a')
  await fill(cache, 'c', records(40))

  expect(cache.getIfCached('b')).toBeUndefined()
  expect(cache.getIfCached('a')).toBeDefined()
  expect(cache.getIfCached('c')).toBeDefined()
})

test('keeps a slice larger than the whole budget', async () => {
  const cache = makeCache(10)
  const p = fill(cache, 'big', records(1000))
  await p
  // it must not evict itself, or it would be re-decoded on every single query
  expect(cache.getIfCached('big')).toBe(p)
})

test('keeps every slice of one over-budget batch', async () => {
  const cache = makeCache(100)
  // what getRecordsForRange does: start every slice of the range at once. The
  // caller holds all of them until it returns, so evicting one frees nothing
  // and only guarantees the next identical query re-decodes it
  const keys = ['a', 'b', 'c', 'd', 'e', 'f']
  await Promise.all(keys.map(key => fill(cache, key, records(40))))

  for (const key of keys) {
    expect(cache.getIfCached(key)).toBeDefined()
  }
})

test('evicts the previous batch once a new one lands', async () => {
  const cache = makeCache(100)
  await Promise.all(['a', 'b'].map(key => fill(cache, key, records(40))))
  await fill(cache, 'c', records(40))

  // 'a' and 'b' are no longer protected, so the budget applies to them again
  expect(cache.getIfCached('a')).toBeUndefined()
  expect(cache.getIfCached('b')).toBeDefined()
  expect(cache.getIfCached('c')).toBeDefined()
})

test('does not cache a failed decode', async () => {
  const cache = makeCache(100)
  const p = fill(cache, 'a', Promise.reject(new Error('read failed')))
  await expect(p).rejects.toThrow('read failed')
  // a transient failure must not poison the slice for the life of the file
  expect(cache.getIfCached('a')).toBeUndefined()
})

test('a second call for a live key joins rather than decoding again', async () => {
  const cache = makeCache(100)
  let decodes = 0
  const decode = () => {
    decodes++
    return records(60)
  }

  const first = await cache.get('a', undefined, decode)
  const second = await cache.get('a', undefined, decode)

  // the whole point of the cache, and the reason `getOrFill` replaced `set`:
  // asking for a slice that is already there — or already decoding — must not
  // start a second decode, so its weight can never be counted twice either
  expect(decodes).toBe(1)
  expect(second).toBe(first)

  await fill(cache, 'b', records(40))
  expect(cache.getIfCached('a')).toBeDefined()
  expect(cache.getIfCached('b')).toBeDefined()
})

// ---------------------------------------------------------------------------
// Reference-counted cancellation
// ---------------------------------------------------------------------------

test('one consumer aborting does not cancel a decode another is waiting on', async () => {
  const cache = makeCache(100)
  const { promise, resolve } = deferred()
  const leaving = new AbortController()
  const staying = new AbortController()
  let fillSignal: AbortSignal | undefined

  const first = cache.get('a', leaving.signal, signal => {
    fillSignal = signal
    return promise
  })
  const second = cache.get('a', staying.signal, () => promise)

  leaving.abort()
  // the decode is still wanted by `staying`, so it must keep going
  expect(fillSignal!.aborted).toBe(false)

  resolve(new Array(3).fill(null))
  // ...and the caller that left still hears about its own cancellation
  await expect(first).rejects.toThrow(/abort/i)
  expect(await second).toHaveLength(3)
})

test('a decode is cancelled once every consumer has aborted', async () => {
  const cache = makeCache(100)
  const { promise, reject } = deferred()
  const one = new AbortController()
  const two = new AbortController()
  let fillSignal: AbortSignal | undefined

  const first = cache.get('a', one.signal, signal => {
    fillSignal = signal
    return promise
  })
  const second = cache.get('a', two.signal, () => promise)

  one.abort()
  expect(fillSignal!.aborted).toBe(false)
  two.abort()
  expect(fillSignal!.aborted).toBe(true)

  // a real fill would reject because its reads were cancelled
  reject(new DOMException('aborted', 'AbortError'))
  await expect(first).rejects.toThrow(/abort/i)
  await expect(second).rejects.toThrow(/abort/i)
  // the abandoned decode is evicted immediately, not left for a later query to
  // join and be told it was cancelled
  expect(cache.getIfCached('a')).toBeUndefined()
})

test('a consumer with no signal pins the decode', async () => {
  const cache = makeCache(100)
  const { promise, resolve } = deferred()
  const leaving = new AbortController()
  let fillSignal: AbortSignal | undefined

  const first = cache.get('a', leaving.signal, signal => {
    fillSignal = signal
    return promise
  })
  // a caller that never asked to be cancellable can never give up, so no set of
  // aborts should stop the decode it is waiting on
  const second = cache.get('a', undefined, () => promise)

  leaving.abort()
  expect(fillSignal!.aborted).toBe(false)

  resolve(new Array(2).fill(null))
  await expect(first).rejects.toThrow(/abort/i)
  expect(await second).toHaveLength(2)
})

test('a hit on a settled slice does not retain the caller', async () => {
  const cache = makeCache(100)
  await cache.get('a', undefined, () => records(5))

  // A settled entry has taken its abort listeners back off its consumers'
  // signals, so a consumer registered after that point could never be
  // unregistered: it sat in the set for as long as the LRU held the slice,
  // holding that query's AbortController with it. jbrowse pans back over cached
  // slices constantly, so this grew without bound on exactly the hot path the
  // cache exists to make cheap.
  for (let i = 0; i < 50; i++) {
    await cache.get('a', new AbortController().signal, () => records(5))
  }
  expect(cache.waiterCount('a')).toBe(0)
})

test('a consumer that already aborted does not keep a decode alive', async () => {
  const cache = makeCache(100)
  const { promise, reject } = deferred()
  const live = new AbortController()
  const dead = new AbortController()
  dead.abort()
  let fillSignal: AbortSignal | undefined

  const first = cache.get('a', live.signal, signal => {
    fillSignal = signal
    return promise
  })
  await expect(cache.get('a', dead.signal, () => promise)).rejects.toThrow(
    /abort/i,
  )

  // The failure mode being guarded: an `abort` listener never fires on a signal
  // that aborted before it was added, so counting `dead` as a waiter would
  // leave it in the set forever and this decode could never be cancelled by
  // anyone. `@gmod/bam` shipped exactly that at a layer with no equivalent of
  // getOrFill's up-front check, and it was the ordinary pan rather than an edge
  // case — the abort lands while the index is still being read.
  live.abort()
  expect(fillSignal!.aborted).toBe(true)

  reject(new DOMException('aborted', 'AbortError'))
  await expect(first).rejects.toThrow(/abort/i)
})

test('an already-aborted consumer never joins', async () => {
  const cache = makeCache(100)
  const controller = new AbortController()
  controller.abort()
  let filled = false

  await expect(
    cache.get('a', controller.signal, () => {
      filled = true
      return records(1)
    }),
  ).rejects.toThrow(/abort/i)
  expect(filled).toBe(false)
  expect(cache.getIfCached('a')).toBeUndefined()
})

test('a decode every consumer has abandoned is not joined', async () => {
  const cache = makeCache(100)
  // never settles, modelling a fill that ignores the signal it was handed —
  // `LocalFile` does exactly that, so a cancelled decode really can keep running
  const { promise } = deferred()
  const leaving = new AbortController()

  const first = cache.get('a', leaving.signal, () => promise)
  void first.catch(() => undefined)
  leaving.abort()

  // Nothing is left that wants this decode, so a consumer arriving now must get
  // its own rather than join one already cancelled — joining it means inheriting
  // a cancellation that has nothing to do with this caller, which is the leak
  // this whole class exists to prevent. `getOrFill` has no check for it: the
  // eviction listener in `start` is what makes the doomed entry unfindable, so
  // this is the test that pins that listener.
  let refilled = false
  const second = await cache.get('a', undefined, () => {
    refilled = true
    return records(3)
  })
  expect(refilled).toBe(true)
  expect(second).toHaveLength(3)
})

test('the same signal joining twice counts once', async () => {
  const cache = makeCache(100)
  const { promise, reject } = deferred()
  const controller = new AbortController()
  let fillSignal: AbortSignal | undefined

  // what a viewAsPairs query does when a read and its mate land in one slice
  const first = cache.get('a', controller.signal, signal => {
    fillSignal = signal
    return promise
  })
  const second = cache.get('a', controller.signal, () => promise)

  controller.abort()
  // one signal is one consumer, however many times it joined — otherwise the
  // decode would outlive the only caller that wanted it
  expect(fillSignal!.aborted).toBe(true)

  reject(new DOMException('aborted', 'AbortError'))
  await expect(first).rejects.toThrow(/abort/i)
  await expect(second).rejects.toThrow(/abort/i)
})
