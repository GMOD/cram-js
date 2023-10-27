//@ts-nocheck
import { fullFiles as testFileList } from './lib/testFileList'
import {
  fs,
  JsonClone,
  loadTestJSON,
  REWRITE_EXPECTED_DATA,
  testDataFile,
} from './lib/util'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

describe('dumping cram files', () => {
  testFileList.forEach(filename => {
    // if (filename !== 'c1#noseq.tmp.cram') {
    //   return
    // }
    // ;['xx#unsorted.tmp.cram'].forEach(filename => {
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
      // console.log(JSON.stringify(fileData, null, '  '))
      if (REWRITE_EXPECTED_DATA) {
        fs.writeFileSync(
          `test/data/${filename}.dump.json`,
          JSON.stringify(fileData, null, '  '),
        )
      }
      const expectedFeatures = JsonClone(
        await loadTestJSON(`${filename}.dump.json`),
      )
      const data: any[] = JsonClone(fileData)
      for (let i = 0; i < data.length; i++) {
        const datum = data[i]
        const expectedDatum = expectedFeatures[i]
        try {
          if (isIterable(datum.data)) {
            for (const data2 of datum.data) {
              if (data2.header && data2.header.parsedContent) {
                data2.header.content = data2.header.parsedContent
                delete data2.header.parsedContent
              }
            }
          }

          expect(datum).toEqual(expectedDatum)
        } catch (e) {
          throw e
        }
      }
      expect(data).toEqual(expectedFeatures)
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

test('lzma', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('hts-specs/ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hts-specs/0903_comp_lzma.cram'),
    seqFetch,
  })
  const fileData = await dumpWholeFile(file)
  const feat = fileData[2].data[1].features[0]
  const hardClip = feat.readFeatures[0]
  const nextReadFeature = feat.readFeatures[0]
  expect(hardClip.refPos).toEqual(1050)
  expect(nextReadFeature.refPos).toEqual(1050)
  expect(hardClip.refPos).toEqual(1050)
  expect(hardClip.pos).toEqual(51)
  expect(hardClip.data).toEqual(1)
})

test('bzip2', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('hts-specs/ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hts-specs/0902_comp_bz2.cram'),
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
