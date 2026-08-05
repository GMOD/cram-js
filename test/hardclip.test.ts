import { expect, test } from 'vitest'

import { dumpWholeFile, sliceRecords } from './lib/dumpFile.ts'
import { CramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'
import { testDataFile } from './lib/util.ts'

test('works with hard clipping', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('volvox.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hard_clipping.cram'),
    fetchReferenceSequence: seqFetch,
  })
  const fileData = await dumpWholeFile(file)
  const feat = sliceRecords(fileData, 2, 1)[0]!
  const readFeatures = feat.readFeatures!
  const hardClip = readFeatures[0]!
  const nextReadFeature = readFeatures[0]!
  expect(hardClip.refPos).toEqual(736)
  expect(nextReadFeature.refPos).toEqual(736)
  expect(hardClip.refPos).toEqual(feat.start)
  expect(hardClip.pos).toEqual(0)
  expect(hardClip.data).toEqual(803)
})
