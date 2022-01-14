//@ts-nocheck
import { fullFiles as testFileList } from './lib/testFileList'
import {
  testDataFile,
  loadTestJSON,
  REWRITE_EXPECTED_DATA,
  fs,
} from './lib/util'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

describe('dumping cram files', () => {
  testFileList.forEach(filename => {
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
      const expectedFeatures = await loadTestJSON(`${filename}.dump.json`)
      expect(JSON.parse(JSON.stringify(fileData))).toEqual(expectedFeatures)
    }, 10000)
  })
})

describe('works with hard clipping', () => {
  it('hard clipped volvox data file', async () => {
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
})
