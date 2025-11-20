import { expect, test } from 'vitest'

import { testDataFile } from './lib/util'
import CraiIndex from '../src/craiIndex'
import { IndexedCramFile } from '../src'
import { FetchableSmallFasta } from './lib/fasta'
import { execSync } from 'child_process'
import { join } from 'path'

test('investigate human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram', async () => {
  const fasta = new FetchableSmallFasta(
    testDataFile('human_g1k_v37.20.21.10M-10M200k.fa'),
  )

  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
    ),
    index: new CraiIndex({
      filehandle: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
      ),
    }),
    seqFetch: fasta.fetch.bind(fasta),
  })

  const features = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)

  console.log(`\nDecoded ${features.length} records from first reference`)

  for (const [i, f] of features.entries()) {
    console.log(`${i + 1}. ${f.readName} - pos: ${f.alignmentStart} - flags: ${f.flags}`)
  }

  // Get samtools output
  const cramPath = join(process.cwd(), 'test', 'data', 'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram')
  const refPath = join(process.cwd(), 'test', 'data', 'human_g1k_v37.20.21.10M-10M200k.fa')
  const samtoolsCmd = `samtools view -T "${refPath}" "${cramPath}" "20"`
  const samtoolsOutput = execSync(samtoolsCmd, { encoding: 'utf8' })
  const samtoolsRecords = samtoolsOutput.trim().split('\n').filter(Boolean)

  console.log(`\nSamtools found ${samtoolsRecords.length} records for ref 20:`)
  for (const [i, line] of samtoolsRecords.entries()) {
    const fields = line.split('\t')
    console.log(`${i + 1}. ${fields[0]} - pos: ${fields[3]} - flags: ${fields[1]}`)
  }

  console.log(`\nMissing: ${samtoolsRecords.length - features.length} record(s)`)

  expect(features.length).toEqual(7)
})
