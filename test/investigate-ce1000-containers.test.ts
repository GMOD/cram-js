import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('investigate ce#1000.tmp.cram containers', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const containerCount = await file.containerCount()
  console.log(`\nFound ${containerCount} containers`)

  let totalRecords = 0
  for (let i = 0; i < containerCount!; i++) {
    const container = await file.getContainerById(i)
    const header = await container.getHeader()

    if (header.numRecords) {
      console.log(`Container ${i + 1}: ${header.numRecords} records (header says)`)

      // Manually find all slices by iterating through blocks
      const compressionHeader = await container.getCompressionHeaderBlock()
      let blockPosition = compressionHeader._endPosition

      for (let b = 0; b < header.numBlocks - 1; b++) {
        const block = await file.readBlock(blockPosition)

        if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
          const sliceOffset = blockPosition - container.filePosition - header._size
          const slice = container.getSlice(sliceOffset)
          const sliceHeader = await slice.getHeader()
          const numRecords = sliceHeader.parsedContent.numRecords
          console.log(`  Slice: ${numRecords} records`)
          totalRecords += numRecords
        }

        blockPosition = block._endPosition
      }
    }
  }

  console.log(`\nTotal expected records from slice headers: ${totalRecords}`)
  console.log('Samtools reports: 1000 records')

  expect(totalRecords).toEqual(1000)
}, 30000)
