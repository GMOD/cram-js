import { test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('noseq using CramFile API directly', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const container = await file.getContainerById(1)
  const header = await container.getHeader()

  console.log(`Container header: ${header.numRecords} records`)

  // Try to get all records using getAllRecords on all slices
  const compressionHeader = await container.getCompressionHeaderBlock()
  let blockPosition = compressionHeader._endPosition

  const allRecords: any[] = []

  // Find all slices
  for (let i = 0; i < header.numBlocks - 1; i++) {
    const block = await file.readBlock(blockPosition)

    if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
      const sliceOffset = blockPosition - container.filePosition - header._size
      const slice = container.getSlice(sliceOffset)

      try {
        const records = await slice.getAllRecords()
        console.log(`Slice at block ${i}: ${records.length} records`)
        allRecords.push(...records)
      } catch (e) {
        console.log(`Slice at block ${i}: ERROR - ${e.message}`)
        console.log(`Error stack: ${e.stack}`)
      }
    }

    blockPosition = block._endPosition
  }

  console.log(`\nTotal records found: ${allRecords.length}`)
  console.log('Names:', allRecords.map(r => r.readName).join(', '))
}, 30000)
