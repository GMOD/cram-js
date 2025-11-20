import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('detailed ce#1000.tmp.cram container analysis', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const containerCount = await file.containerCount()
  console.log(`Total containers: ${containerCount}\n`)

  let grandTotal = 0

  // Check first few containers in detail
  for (let containerId = 0; containerId < Math.min(5, containerCount!); containerId++) {
    const container = await file.getContainerById(containerId)
    const containerHeader = await container.getHeader()

    console.log(`Container ${containerId}:`)
    console.log(`  Container header: ${containerHeader.numRecords} records, ${containerHeader.numSlices} slices, ${containerHeader.numBlocks} blocks`)

    if (containerId === 0 || !containerHeader.numRecords) {
      console.log(`  (Skipping - header container or no records)`)
      continue
    }

    // Get compression header
    const compressionHeader = await container.getCompressionHeaderBlock()
    let blockPosition = compressionHeader._endPosition
    let numBlocks = containerHeader.numBlocks - 1 // subtract compression header

    console.log(`  Starting block position: ${blockPosition}`)
    console.log(`  Blocks to process: ${numBlocks}`)

    let containerRecords = 0
    let sliceNum = 0

    for (let blockNum = 0; blockNum < numBlocks; blockNum++) {
      const block = await file.readBlock(blockPosition)
      console.log(`  Block ${blockNum}: type=${block.contentType}, pos=${blockPosition}, size=${block._size}`)

      if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
        const sliceOffset = blockPosition - container.filePosition - containerHeader._size
        const slice = container.getSlice(sliceOffset)
        const sliceHeader = await slice.getHeader()
        const records = await slice.getAllRecords()

        console.log(`    Slice ${sliceNum}: ${records.length} records, ${sliceHeader.parsedContent.numBlocks} blocks in slice`)
        containerRecords += records.length
        sliceNum++

        // Skip ahead by the number of blocks in this slice
        blockNum += sliceHeader.parsedContent.numBlocks
        console.log(`    Skipping ahead to block ${blockNum + 1}`)
      }

      blockPosition = block._endPosition
    }

    console.log(`  Total records in container ${containerId}: ${containerRecords}`)
    console.log(`  (Header claimed: ${containerHeader.numRecords})`)
    grandTotal += containerRecords
    console.log()
  }

  console.log(`First 5 containers total: ${grandTotal} records`)
}, 60000)
