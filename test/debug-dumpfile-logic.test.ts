import { test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('debug dumpFile logic for noseq', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const containerId = 1
  const container = await file.getContainerById(containerId)
  const containerHeader = await container.getHeader()

  console.log(
    `Container header: ${containerHeader.numRecords} records, ${containerHeader.numBlocks} blocks`,
  )

  const compressionHeader = await container.getCompressionHeaderBlock()
  let blockPosition = compressionHeader._endPosition
  const numBlocks = containerHeader.numBlocks - 1 // subtract compression header

  console.log(
    `Will iterate through ${numBlocks} blocks (0 to ${numBlocks - 1})`,
  )

  const slicesFound: any[] = []

  // Simulate the dumpFile logic
  for (let blockNum = 0; blockNum < numBlocks; blockNum += 1) {
    const block = await file.readBlock(blockPosition)
    console.log(
      `\nIteration: blockNum=${blockNum}, blockType=${block.contentType}`,
    )

    if (
      block.contentType === 'MAPPED_SLICE_HEADER' ||
      block.contentType === 'UNMAPPED_SLICE_HEADER'
    ) {
      const sliceOffset =
        blockPosition - container.filePosition - containerHeader._size
      const slice = container.getSlice(sliceOffset)
      const sliceHeader = await slice.getHeader()

      console.log(
        `  Found slice: ${sliceHeader.parsedContent.numRecords} records, ${sliceHeader.parsedContent.numBlocks} data blocks`,
      )
      console.log(`  Adding ${sliceHeader.parsedContent.numBlocks} to blockNum`)
      console.log(`  blockNum before: ${blockNum}`)

      slicesFound.push({
        blockNum,
        records: sliceHeader.parsedContent.numRecords,
        blocks: sliceHeader.parsedContent.numBlocks,
      })

      blockNum += sliceHeader.parsedContent.numBlocks
      console.log(`  blockNum after: ${blockNum}`)
      console.log(
        `  Next iteration will be blockNum=${blockNum + 1} (after for-loop increment)`,
      )
    } else {
      console.log(`  Non-slice block (will be included in data)`)
    }

    blockPosition = block._endPosition
  }

  console.log(`\nSlices found: ${slicesFound.length}`)
  slicesFound.forEach((s, i) => {
    console.log(
      `  Slice ${i}: at block ${s.blockNum}, ${s.records} records, ${s.blocks} data blocks`,
    )
  })
}, 30000)
