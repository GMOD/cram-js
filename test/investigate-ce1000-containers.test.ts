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

  const containers = []
  for await (const container of file.containers()) {
    containers.push(container)
  }

  console.log(`\nFound ${containers.length} containers`)

  let totalRecords = 0
  for (const [i, container] of containers.entries()) {
    const header = await container.getHeader()
    const slices = await container.getAllSlices()
    console.log(`Container ${i + 1}: ${slices.length} slices`)

    for (const [j, slice] of slices.entries()) {
      const sliceHeader = await slice.getHeader()
      const numRecords = sliceHeader.parsedContent.numRecords
      console.log(`  Slice ${j + 1}: ${numRecords} records`)
      totalRecords += numRecords
    }
  }

  console.log(`\nTotal expected records from slice headers: ${totalRecords}`)
  console.log('Samtools reports: 1000 records')

  expect(totalRecords).toEqual(1000)
}, 30000)
