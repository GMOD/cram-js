import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('debug ce#1000.tmp.cram slice details', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const containerCount = await file.containerCount()
  console.log(`Container count: ${containerCount}`)

  let totalRecords = 0

  // Iterate through each container manually
  for (let i = 0; i < containerCount!; i++) {
    const container = await file.getContainerById(i)
    const header = await container.getHeader()

    console.log(`\nContainer ${i}:`)
    console.log(`  Header says ${header.numRecords} records, ${header.numSlices} slices, ${header.numBlocks} blocks`)

    // Count actual records in this container
    let containerRecords = 0

    // Try to iterate through slices
    let sliceOffset = 0
    for (let s = 0; s < header.numSlices; s++) {
      try {
        const slice = container.getSlice(sliceOffset)
        const sliceHeader = await slice.getHeader()
        const records = await slice.getAllRecords()

        console.log(`  Slice ${s}: ${records.length} records (header says ${sliceHeader.parsedContent.numRecords})`)
        containerRecords += records.length

        // Move to next slice offset
        sliceOffset += sliceHeader._size + sliceHeader.parsedContent.numBlocks * 100 // This is a guess
      } catch (e) {
        console.log(`  Slice ${s}: ERROR - ${e.message}`)
        break
      }
    }

    console.log(`  Total in container: ${containerRecords} records`)
    totalRecords += containerRecords
  }

  console.log(`\nGrand total: ${totalRecords} records`)
  console.log('Expected: 1000 records')
  console.log('Difference: ' + (1000 - totalRecords))
}, 30000)
