import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { dumpWholeFile } from './lib/dumpFile'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('debug ce#1000.tmp.cram containers', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const containerCount = await file.containerCount()
  console.log(`Container count: ${containerCount}`)

  const fileData = await dumpWholeFile(file)
  console.log(`FileData items: ${fileData.length}`)

  let totalRecords = 0
  let containerIndex = 0

  for (const container of fileData) {
    if (container.data) {
      let containerRecords = 0
      for (const item of container.data) {
        if (item.features && Array.isArray(item.features)) {
          containerRecords += item.features.length
        }
      }
      console.log(`Container ${containerIndex}: ${containerRecords} records`)
      totalRecords += containerRecords
      containerIndex++
    }
  }

  console.log(`\nTotal records decoded: ${totalRecords}`)
  console.log('Samtools reports: 1000 records')
  console.log('Difference: ' + (1000 - totalRecords))

  // Also check what samtools says about the structure
  console.log('\nChecking file header...')
  const header = await file.getSamHeader()
  console.log('Header length:', header.length)
}, 30000)
