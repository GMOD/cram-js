//@ts-nocheck
import { t1 as testFileList } from './lib/testFileList'
import { testDataFile } from './lib/util'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

describe('dumping cram files t1', () => {
  testFileList.forEach(filename => {
    it(`can dump the whole ${filename} without error`, async () => {
      let seqFetch
      if (filename.includes('#')) {
        const referenceFileName = filename.replace(/#.+$/, '.fa')
        const fasta = new FetchableSmallFasta(testDataFile(referenceFileName))
        seqFetch = fasta.fetch.bind(fasta)
      }

      const filehandle = testDataFile(filename)
      const file = new CramFile({ filehandle, seqFetch })
      const fileData = await dumpWholeFile(file)
      expect(fileData).toMatchSnapshot()
    }, 10000)
  })
})
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

function isIterable(input) {
  if (input === null || input === undefined) {
    return false
  }

  return typeof input[Symbol.iterator] === 'function'
}
