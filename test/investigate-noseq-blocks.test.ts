import { test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('check noseq block structure', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const container = await file.getContainerById(1)
  const header = await container.getHeader()

  console.log(`Container header: ${header.numRecords} records, ${header.numBlocks} blocks`)

  const compressionHeader = await container.getCompressionHeaderBlock()
  let blockPosition = compressionHeader._endPosition

  for (let i = 0; i < header.numBlocks - 1; i++) {
    const block = await file.readBlock(blockPosition)
    console.log(`Block ${i}: ${block.contentType}, size=${block._size}, pos=${blockPosition}`)

    if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
      const sliceOffset = blockPosition - container.filePosition - header._size
      const slice = container.getSlice(sliceOffset)
      const sliceHeader = await slice.getHeader()
      console.log(`  ^ Slice header: ${sliceHeader.parsedContent.numRecords} records, ${sliceHeader.parsedContent.numBlocks} blocks`)
    }

    blockPosition = block._endPosition
  }
}, 30000)
