import { expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'

test('runs without error', async () => {
  const messages = [] as string[]
  const console = {
    log(msg: string) {
      messages.push(msg)
    },
  }

  // or with local files
  const indexedFile2 = new IndexedCramFile({
    cramPath: require.resolve('./data/ce#5.tmp.cram'),
    index: new CraiIndex({
      path: require.resolve('./data/ce#5.tmp.cram.crai'),
    }),
    seqFetch: async (seqId, start, end) => {
      let fakeSeq = ''
      for (let i = start; i <= end; i += 1) {
        fakeSeq += 'A'
      }
      return fakeSeq
    },
    checkSequenceMD5: false,
  })

  // example of fetching records from an indexed CRAM file.
  // NOTE: only numeric IDs for the reference sequence are accepted
  const records = await indexedFile2.getRecordsForRange(0, 10000, 20000)
  records.forEach(record => {
    console.log(`got a record named ${record.readName}`)
    record.readFeatures?.forEach(({ code, refPos, ref, sub }) => {
      if (code === 'X') {
        console.log(
          `${record.readName} shows a base substitution of ${ref}->${sub} at ${refPos}`,
        )
      }
    })
  })

  expect(messages).toEqual([
    'got a record named VI',
    'VI shows a base substitution of A->C at 2',
    'VI shows a base substitution of A->C at 28',
    'VI shows a base substitution of A->C at 100029',
    'VI shows a base substitution of A->C at 100101',
  ])
})

test('reports download progress for getRecordsForRange', async () => {
  const indexedFile = new IndexedCramFile({
    cramPath: require.resolve('./data/ce#5.tmp.cram'),
    index: new CraiIndex({
      path: require.resolve('./data/ce#5.tmp.cram.crai'),
    }),
    seqFetch: async (seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })

  const ticks: [number, number][] = []
  await indexedFile.getRecordsForRange(0, 10000, 20000, {
    onProgress: (downloaded, total) => {
      ticks.push([downloaded, total])
    },
  })

  expect(ticks[0]![0]).toEqual(0)
  expect(ticks[0]![1]).toBeGreaterThan(0)
  expect(ticks.at(-1)![0]).toEqual(ticks[0]![1])
  for (let i = 1; i < ticks.length; i++) {
    expect(ticks[i]![0]).toBeGreaterThanOrEqual(ticks[i - 1]![0])
  }
})
