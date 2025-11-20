import { execSync } from 'child_process'
import { join } from 'path'

import { expect, test } from 'vitest'

import { IndexedCramFile } from '../src'
import { testDataFile } from './lib/util'
import CraiIndex from '../src/craiIndex'
import { FetchableSmallFasta } from './lib/fasta'

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
    const isUnmapped = f.flags & 4
    const readBases = f.getReadBases ? f.getReadBases() : null
    const cigar = f.getCigarString ? f.getCigarString() : '*'
    console.log(
      `${i + 1}. ${f.readName} - pos: ${f.alignmentStart} - flags: ${f.flags} - ` +
        `unmapped: ${!!isUnmapped} - cigar: ${cigar} - seq: ${readBases ? readBases.slice(0, 10) + '...' : 'null'}`,
    )
  }

  // Get samtools output
  const cramPath = join(
    process.cwd(),
    'test',
    'data',
    'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
  )
  const refPath = join(
    process.cwd(),
    'test',
    'data',
    'human_g1k_v37.20.21.10M-10M200k.fa',
  )
  const samtoolsCmd = `samtools view -T "${refPath}" "${cramPath}" "20"`
  console.log(samtoolsCmd)
  const samtoolsOutput = execSync(samtoolsCmd, { encoding: 'utf8' })
  const samtoolsRecords = samtoolsOutput.trim().split('\n').filter(Boolean)

  console.log(`\nSamtools found ${samtoolsRecords.length} records for ref 20:`)
  for (const [i, line] of samtoolsRecords.entries()) {
    const fields = line.split('\t')
    const flags = parseInt(fields[1])
    const isUnmapped = flags & 4
    const cigar = fields[5]
    const seq = fields[9]
    console.log(
      `${i + 1}. ${fields[0]} - pos: ${fields[3]} - flags: ${fields[1]} - ` +
        `unmapped: ${!!isUnmapped} - cigar: ${cigar} - seq: ${seq.slice(0, 10)}...`,
    )
  }

  console.log(
    `\nMissing: ${samtoolsRecords.length - features.length} record(s)`,
  )

  expect(features.length).toEqual(7)
})
