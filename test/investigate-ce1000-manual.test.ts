import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('manually iterate ce#1000.tmp.cram', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  let totalRecords = 0

  // Test just container 1
  const container = await file.getContainerById(1)
  const containerHeader = await container.getHeader()

  console.log(`Container 1 header: ${containerHeader.numRecords} records, ${containerHeader.numBlocks} blocks`)

  // Get compression header
  const compressionHeader = await container.getCompressionHeaderBlock()
  let blockPosition = compressionHeader._endPosition

  const slices: any[] = []

  // Read ALL blocks and look for slice headers
  for (let i = 0; i < containerHeader.numBlocks - 1; i++) {
    const block = await file.readBlock(blockPosition)

    if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
      const sliceOffset = blockPosition - container.filePosition - containerHeader._size
      const slice = container.getSlice(sliceOffset)
      const sliceHeader = await slice.getHeader()
      const records = await slice.getAllRecords()

      console.log(`Found slice at block ${i}: ${records.length} records, ${sliceHeader.parsedContent.numBlocks} blocks`)
      slices.push({ records: records.length, blocks: sliceHeader.parsedContent.numBlocks })
      totalRecords += records.length
    }

    blockPosition = block._endPosition
  }

  console.log(`\nTotal slices found: ${slices.length}`)
  console.log(`Total records: ${totalRecords}`)
  console.log(`Expected (from header): ${containerHeader.numRecords}`)

  expect(totalRecords).toEqual(containerHeader.numRecords)
}, 30000)
