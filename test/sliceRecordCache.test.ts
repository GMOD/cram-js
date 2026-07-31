import { expect, test } from 'vitest'

import SliceRecordCache from '../src/cramFile/sliceRecordCache.ts'

import type CramRecord from '../src/cramFile/record.ts'

// the cache only ever reads `.length` off the resolved array
const records = (n: number) =>
  Promise.resolve(new Array(n).fill(null) as unknown as CramRecord[])

test('serves a cached slice back', async () => {
  const cache = new SliceRecordCache(100)
  const p = records(10)
  cache.set('a', p)
  await p
  expect(cache.get('a')).toBe(p)
  expect(cache.get('missing')).toBeUndefined()
})

test('bounds by record count, not by number of slices', async () => {
  const cache = new SliceRecordCache(100)
  // three slices of 40 records: the third must push the first out, even though
  // an entry-counting cache would happily hold all three
  for (const key of ['a', 'b', 'c']) {
    const p = records(40)
    cache.set(key, p)
    await p
  }
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('b')).toBeDefined()
  expect(cache.get('c')).toBeDefined()
})

test('evicts least recently used', async () => {
  const cache = new SliceRecordCache(100)
  for (const key of ['a', 'b']) {
    const p = records(40)
    cache.set(key, p)
    await p
  }
  // touch 'a' so 'b' becomes the least recently used
  void cache.get('a')
  const p = records(40)
  cache.set('c', p)
  await p

  expect(cache.get('b')).toBeUndefined()
  expect(cache.get('a')).toBeDefined()
  expect(cache.get('c')).toBeDefined()
})

test('keeps a slice larger than the whole budget', async () => {
  const cache = new SliceRecordCache(10)
  const p = records(1000)
  cache.set('big', p)
  await p
  // it must not evict itself, or it would be re-decoded on every single query
  expect(cache.get('big')).toBe(p)
})

test('does not cache a failed decode', async () => {
  const cache = new SliceRecordCache(100)
  const p = Promise.reject(new Error('read failed'))
  cache.set('a', p)
  await expect(p).rejects.toThrow('read failed')
  // a transient failure must not poison the slice for the life of the file
  expect(cache.get('a')).toBeUndefined()
})

test('does not double-count a key that is set twice', async () => {
  const cache = new SliceRecordCache(100)
  const first = records(60)
  cache.set('a', first)
  await first
  const second = records(60)
  cache.set('a', second)
  await second
  // 'a' replaced itself; its old weight must have been released, so a second
  // 60-record slice still fits alongside nothing else being evicted wrongly
  expect(cache.get('a')).toBe(second)

  const b = records(40)
  cache.set('b', b)
  await b
  expect(cache.get('b')).toBeDefined()
})
