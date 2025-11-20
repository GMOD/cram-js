import { expect, test } from 'vitest'

import { testDataFile } from './lib/util'
import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { dumpWholeFile } from './lib/dumpFile'

test('investigate ce#1000.tmp.cram', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const fileData = await dumpWholeFile(file)

  let recordCount = 0

  for (const container of fileData) {
    if (container.data) {
      for (const item of container.data) {
        if (item.features && Array.isArray(item.features)) {
          recordCount += item.features.length
        }
      }
    }
  }

  console.log(`\nTotal records decoded: ${recordCount}`)
  console.log('Samtools reports: 1000 records')
  console.log('Difference: ' + (1000 - recordCount))

  expect(recordCount).toEqual(1000)
}, 30000)
