import { test } from 'vitest'
import { t3 as testFileList } from './lib/testFileList'
import { testDataFile } from './lib/util'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

type Callback = (id: number, start: number, end: number) => Promise<string>
testFileList.forEach(filename => {
  test(`can dump the whole ${filename} without error`, async () => {
    let seqFetch: Callback | undefined
    if (filename.includes('#')) {
      const referenceFileName = filename.replace(/#.+$/, '.fa')
      const fasta = new FetchableSmallFasta(testDataFile(referenceFileName))
      seqFetch = fasta.fetch.bind(fasta)
    }

    const filehandle = testDataFile(filename)
    const file = new CramFile({
      filehandle,
      seqFetch,
    })
    await dumpWholeFile(file) // just try to decode it, no snapshot test for now as it is large
  }, 10000)
})
