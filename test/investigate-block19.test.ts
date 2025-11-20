import { test } from 'vitest'

import { CramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('check block 19 in container 1', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('ce#1000.tmp.cram'),
    seqFetch,
  })

  const container = await file.getContainerById(1)
  const containerHeader = await container.getHeader()
  const compressionHeader = await container.getCompressionHeaderBlock()
  let blockPosition = compressionHeader._endPosition

  for (let i = 0; i <= 21; i++) {
    const block = await file.readBlock(blockPosition)
    console.log(`Block ${i}: type=${block.contentType}, size=${block._size}, pos=${blockPosition}`)
    blockPosition = block._endPosition
  }
}, 30000)
