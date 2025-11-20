import { test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('detailed noseq investigation', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const containerCount = await file.containerCount()
  console.log(`Container count: ${containerCount}`)

  for (let i = 0; i < containerCount!; i++) {
    const container = await file.getContainerById(i)
    const header = await container.getHeader()

    console.log(`\nContainer ${i}:`)
    console.log(`  Header: ${header.numRecords} records, ${header.numBlocks} blocks`)

    if (i === 0 || !header.numRecords) {
      console.log(`  (Skipping - header container)`)
      continue
    }

    // Manually iterate through blocks to find slices
    const compressionHeader = await container.getCompressionHeaderBlock()
    let blockPosition = compressionHeader._endPosition
    let sliceNum = 0

    for (let b = 0; b < header.numBlocks - 1; b++) {
      const block = await file.readBlock(blockPosition)

      if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
        const sliceOffset = blockPosition - container.filePosition - header._size
        const slice = container.getSlice(sliceOffset)
        const sliceHeader = await slice.getHeader()

        console.log(`  Slice ${sliceNum}: ${sliceHeader.parsedContent.numRecords} records expected`)

        try {
          const records = await slice.getAllRecords()
          console.log(`    Actually decoded: ${records.length} records`)

          records.forEach((r, idx) => {
            const seq = r.getReadBases ? r.getReadBases() : 'N/A'
            const qual = r.qualityScores || []
            console.log(`    Record ${idx}: ${r.readName}, seq=${seq}, seqLen=${r.readLength}, flags=${r.flags}, qualLen=${qual.length}`)
          })
        } catch (e) {
          console.log(`    ERROR decoding: ${e.message}`)
        }

        sliceNum++
      }

      blockPosition = block._endPosition
    }
  }
}, 30000)
