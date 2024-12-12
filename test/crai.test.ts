import { testDataFile } from './lib/util'
import { test, expect } from 'vitest'

import CraiIndex from '../src/craiIndex'

test('can read xx#unsorted.tmp.cram.crai', async () => {
  const filehandle = testDataFile('xx#unsorted.tmp.cram.crai')
  const index = new CraiIndex({ filehandle })
  const data = await index.getIndex()
  expect(data).toEqual({
    0: [
      {
        start: 1,
        span: 20,
        containerStart: 562,
        sliceStart: 143,
        sliceBytes: 200,
      },
      {
        start: 1,
        span: 20,
        containerStart: 923,
        sliceStart: 173,
        sliceBytes: 243,
      },
    ],
    1: [
      {
        start: 1,
        span: 10,
        containerStart: 923,
        sliceStart: 173,
        sliceBytes: 243,
      },
      {
        start: 11,
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
        start: 100009,
        span: 102,
        containerStart: 1953,
        sliceStart: 592,
        sliceBytes: 1024,
      },
    ],
    '-1': [
      {
        start: 0,
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
        start: 1,
        span: 12495,
        containerStart: 418,
        sliceStart: 278,
        sliceBytes: 537131,
      },
      {
        start: 12405,
        span: 13371,
        containerStart: 537849,
        sliceStart: 278,
        sliceBytes: 538434,
      },
      {
        start: 25679,
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
      start: 25679,
    },
  ])
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
