import { testDataFile } from './lib/util'
import { test, expect } from 'vitest'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

test('works with hard clipping', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('volvox.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hard_clipping.cram'),
    seqFetch,
  })
  const fileData = await dumpWholeFile(file)
  const feat = fileData[2].data[1].features[0]
  const hardClip = feat.readFeatures[0]
  const nextReadFeature = feat.readFeatures[0]
  expect(hardClip.refPos).toEqual(737)
  expect(nextReadFeature.refPos).toEqual(737)
  expect(hardClip.refPos).toEqual(feat.alignmentStart)
  expect(hardClip.pos).toEqual(1)
  expect(hardClip.data).toEqual(803)
})
