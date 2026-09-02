import { BlobFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'

// .crai text is parsed digit-by-digit in a hand-rolled loop for speed, so the
// cases below pin down the parser's handling of separators, signs and
// malformed input rather than going through a fixture file
function indexFromText(text: string) {
  return new CraiIndex({
    filehandle: new BlobFile(new Blob([new TextEncoder().encode(text)])),
  })
}

const entry = (seqId: number) => ({
  seqId,
  start: 0,
  span: 20,
  containerStart: 562,
  sliceStart: 143,
  sliceBytes: 200,
})

test('parses a record with no trailing newline', async () => {
  expect(await indexFromText('0\t1\t20\t562\t143\t200').getIndex()).toEqual({
    0: [entry(0)],
  })
})

test('parses negative sequence ids', async () => {
  expect(await indexFromText('-1\t1\t20\t562\t143\t200\n').getIndex()).toEqual({
    '-1': [entry(-1)],
  })
})

test('parses multi-digit values exactly', async () => {
  const data = await indexFromText(
    '0\t100009\t102\t1953\t592\t1024\n',
  ).getIndex()
  expect(data[0]).toEqual([
    {
      seqId: 0,
      start: 100008,
      span: 102,
      containerStart: 1953,
      sliceStart: 592,
      sliceBytes: 1024,
    },
  ])
})

test('tolerates blank lines and trailing whitespace', async () => {
  const data = await indexFromText(
    '0\t1\t20\t562\t143\t200\n\n0\t1\t20\t562\t143\t200\r\n',
  ).getIndex()
  expect(data[0]).toEqual([entry(0), entry(0)])
})

test('throws on a record with too few fields', async () => {
  await expect(
    indexFromText('0\t1\t20\t562\t143\n').getIndex(),
  ).rejects.toThrow(/expected 6 fields/)
})

test('throws on a record with too many fields', async () => {
  await expect(
    indexFromText('0\t1\t20\t562\t143\t200\t7\n').getIndex(),
  ).rejects.toThrow(/more than 6 fields/)
})

test('throws on an empty field rather than yielding NaN', async () => {
  await expect(
    indexFromText('0\t\t20\t562\t143\t200\n').getIndex(),
  ).rejects.toThrow(/empty numeric field/)
})

test('throws on non-numeric content', async () => {
  await expect(
    indexFromText('0\tx\t20\t562\t143\t200\n').getIndex(),
  ).rejects.toThrow(/invalid \.crai index file/)
})

test('can read xx#unsorted.tmp.cram.crai', async () => {
  const filehandle = testDataFile('xx#unsorted.tmp.cram.crai')
  const index = new CraiIndex({ filehandle })
  const data = await index.getIndex()
  expect(data).toEqual({
    0: [
      {
        seqId: 0,
        start: 0,
        span: 20,
        containerStart: 562,
        sliceStart: 143,
        sliceBytes: 200,
      },
      {
        seqId: 0,
        start: 0,
        span: 20,
        containerStart: 923,
        sliceStart: 173,
        sliceBytes: 243,
      },
    ],
    1: [
      {
        seqId: 1,
        start: 0,
        span: 10,
        containerStart: 923,
        sliceStart: 173,
        sliceBytes: 243,
      },
      {
        seqId: 1,
        start: 10,
        span: 10,
        containerStart: 252,
        sliceStart: 181,
        sliceBytes: 111,
      },
    ],
  })

  expect(await index.getEntriesForRange(2, 0, 0)).toEqual([])
  expect(await index.getEntriesForRange(-1, 9, 9)).toEqual([])
  expect(await index.getEntriesForRange(0, 100, 300)).toEqual([])
  expect(await index.getEntriesForRange(0, -100, -80)).toEqual([])
  expect(await index.getEntriesForRange(0, 0, 20)).toEqual(data[0])
  expect(await index.getEntriesForRange(0, 1, 21)).toEqual(data[0])
  expect(await index.getEntriesForRange(1, 0, 20)).toEqual(data[1])
})

test('throws an error if you try to read cramQueryWithCRAI.cram as a .crai', () => {
  const filehandle = testDataFile(
    'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
  )
  const index = new CraiIndex({ filehandle })
  const dataP = index.getIndex()
  return dataP.then(
    () => {
      throw new Error('the getIndex call should have failed')
    },
    (err: unknown) => {
      expect(`${err}`).toMatch(/invalid/)
    },
  )
})

test('can read cramQueryWithCRAI.cram.crai', async () => {
  const filehandle = testDataFile(
    'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
  )
  const index = new CraiIndex({ filehandle })
  const data = await index.getIndex()
  // console.log(JSON.stringify(data, null, ' '))
  expect(data).toEqual({
    0: [
      {
        seqId: 0,
        start: 100008,
        span: 102,
        containerStart: 1953,
        sliceStart: 592,
        sliceBytes: 1024,
      },
    ],
    '-1': [
      {
        seqId: -1,
        start: -1,
        span: 1,
        containerStart: 3590,
        sliceStart: 209,
        sliceBytes: 271,
      },
    ],
  })
})
test('can read small crai file', async () => {
  const filehandle = testDataFile('SRR396636.sorted.clip.cram.crai')
  const index = new CraiIndex({ filehandle })
  const data = await index.getIndex()
  // console.log(data)
  expect(data).toEqual({
    0: [
      {
        seqId: 0,
        start: 0,
        span: 12495,
        containerStart: 418,
        sliceStart: 278,
        sliceBytes: 537131,
      },
      {
        seqId: 0,
        start: 12404,
        span: 13371,
        containerStart: 537849,
        sliceStart: 278,
        sliceBytes: 538434,
      },
      {
        seqId: 0,
        start: 25678,
        span: 4414,
        containerStart: 1076585,
        sliceStart: 281,
        sliceBytes: 167795,
      },
    ],
  })
  expect(await index.getEntriesForRange(0, 25999, 26499)).toEqual([
    {
      containerStart: 1076585,
      sliceBytes: 167795,
      sliceStart: 281,
      span: 4414,
      seqId: 0,
      start: 25678,
    },
  ])
})

// getEntriesForRange binary-searches the sorted entries rather than filtering
// all of them, bounding the search below by the longest span on the reference.
// A short slice sitting between a long one and the query is what breaks a
// lower bound derived from anything narrower than that maximum.
test('finds a long slice that starts well before the query', async () => {
  const index = indexFromText(
    [
      // start (1-based), span: a very long slice, then short ones after it
      '0\t1\t10000\t100\t0\t50', // 0..10000  — overlaps
      '0\t101\t10\t200\t0\t50', // 100..110  — does not
      '0\t5001\t10\t300\t0\t50', // 5000..5010 — does not
      '0\t9001\t2000\t400\t0\t50', // 9000..11000 — overlaps
      '0\t20001\t10\t500\t0\t50', // 20000..20010 — does not
      '',
    ].join('\n'),
  )
  const hits = await index.getEntriesForRange(0, 9500, 9600)
  expect(hits.map(h => h.containerStart)).toEqual([100, 400])
})

test('returns entries in index order, with no lower bound to find', async () => {
  const index = indexFromText(
    ['0\t1\t50\t100\t0\t50', '0\t11\t50\t200\t0\t50', ''].join('\n'),
  )
  expect(
    (await index.getEntriesForRange(0, 0, 100)).map(h => h.containerStart),
  ).toEqual([100, 200])
  // a query entirely before every entry, and one entirely after
  expect(await index.getEntriesForRange(0, -50, 0)).toEqual([])
  expect(await index.getEntriesForRange(0, 1000, 2000)).toEqual([])
})

test('test a BAI', async () => {
  const filehandle = testDataFile('volvox-sorted.bam.bai')
  const index = new CraiIndex({ filehandle })
  return index.getIndex().then(
    () => {
      throw new Error('the getIndex call should have failed')
    },
    (err: unknown) => {
      expect(`${err}`).toMatch(/bai/)
    },
  )
})
