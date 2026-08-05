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
    fetchReferenceSequence: async (seqId, start, end) => {
      let fakeSeq = ''
      for (let i = start; i <= end; i += 1) {
        fakeSeq += 'A'
      }
      return fakeSeq
    },
    checkSequenceMD5: false,
  })

  // getRecordsForRange takes a numeric reference ID: the index of the @SQ line
  // in the header, which cram.getReferenceId(name) resolves
  const refId = await indexedFile2.cram.getReferenceId('CHROMOSOME_I')
  const records = await indexedFile2.getRecordsForRange(refId, 10000, 20000)
  records.forEach(record => {
    console.log(`got a record named ${record.readName}`)
    record.readFeatures?.forEach(feature => {
      // ReadFeature is a discriminated union on `code`, so `ref` and `sub`
      // only exist once it is narrowed to the substitution case
      if (feature.code === 'X') {
        console.log(
          `${record.readName} shows a base substitution of ${feature.ref}->${feature.sub} at ${feature.refPos}`,
        )
      }
    })
  })

  expect(messages).toEqual([
    'got a record named VI',
    'VI shows a base substitution of A->C at 1',
    'VI shows a base substitution of A->C at 27',
    'VI shows a base substitution of A->C at 100028',
    'VI shows a base substitution of A->C at 100100',
  ])
})

test('reports download progress for getRecordsForRange', async () => {
  const indexedFile = new IndexedCramFile({
    cramPath: require.resolve('./data/ce#5.tmp.cram'),
    index: new CraiIndex({
      path: require.resolve('./data/ce#5.tmp.cram.crai'),
    }),
    // 0-based half-open since v10, so the string is `end - start` long
    fetchReferenceSequence: async (seqId, start, end) =>
      'A'.repeat(end - start),
    checkSequenceMD5: false,
  })

  // totalBytes is optional on onProgress: a source that cannot report a
  // content length calls back with only the first argument
  const ticks: [number, number | undefined][] = []
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
