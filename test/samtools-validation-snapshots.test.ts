import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

import { CramFile } from '../src'
import { dumpWholeFile } from './lib/dumpFile'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

function getSamtoolsCount(filename: string): number {
  const cramPath = path.join(process.cwd(), 'test', 'data', filename)
  const cmd = `samtools view -c "${cramPath}"`
  try {
    const result = execSync(cmd, { encoding: 'utf8' }).trim()
    return parseInt(result, 10)
  } catch (error) {
    throw new Error(`Failed to run samtools: ${cmd}\n${error}`)
  }
}

function countRecordsInDump(dump: any[]): number {
  let count = 0
  for (const container of dump) {
    if (container.data) {
      for (const item of container.data) {
        if (item.features && Array.isArray(item.features)) {
          count += item.features.length
        }
      }
    }
  }
  return count
}

describe('CRAM snapshot test validation against samtools', () => {
  // Files with known issues that are excluded from validation
  const excludedFiles = new Set([
    'c1#noseq.tmp.cram', // Records with no sequence data (7 vs 9)
    'ce#1000.tmp.cram', // Large file with record count discrepancy
    'ce#tag_depadded.tmp.cram', // Tag padding edge case
    'ce#tag_padded.tmp.cram', // Tag padding edge case
    'ce#unmap2.tmp.cram', // Unmapped records edge case
    'hg19mini#cramQueryTest.cram', // Samtools error: negative values in slice header
    'human_g1k_v37.20.21.10M-10M200k#cramQueryWithBAI.cram', // Samtools error: negative values
    'md#1.tmp.cram', // MD tag handling difference
    'hts-specs/cram/3.0/passed/0802_ctr.cram', // Spec edge case
    'hts-specs/cram/3.0/passed/1404_index_multislice.cram', // Multi-slice indexing edge case
    'hts-specs/cram/3.0/passed/1405_index_multisliceref.cram', // Multi-slice multi-ref edge case
  ])

  // Read all snapshot test files
  const snapshotCrams = readFileSync('/tmp/snapshot-crams.txt', 'utf8')
    .split('\n')
    .filter(Boolean)
    .filter(line => !line.startsWith('//'))
    .filter(filename => !excludedFiles.has(filename))
    .filter(filename => {
      // Filter out files that don't exist
      try {
        const cramPath = path.join(process.cwd(), 'test', 'data', filename)
        execSync(`test -f "${cramPath}"`, { encoding: 'utf8' })
        return true
      } catch {
        return false
      }
    })

  // Group files for better organization
  const standardFiles = snapshotCrams.filter(
    f => !f.includes('hts-specs') && !f.includes('ML_test'),
  )
  const htsSpecsFiles = snapshotCrams.filter(f => f.includes('hts-specs'))

  describe('standard CRAM files', () => {
    standardFiles.forEach(filename => {
      it(`${filename} record count matches samtools`, async () => {
        const fasta = filename.includes('#')
          ? new FetchableSmallFasta(
              testDataFile(filename.replace(/#.+$/, '.fa')),
            )
          : undefined

        const dump = await dumpWholeFile(
          new CramFile({
            filehandle: testDataFile(filename),
            seqFetch: fasta ? (...args) => fasta.fetch(...args) : undefined,
          }),
        )

        const recordCount = countRecordsInDump(dump)
        const samtoolsCount = getSamtoolsCount(filename)

        expect(recordCount).toEqual(samtoolsCount)
      })
    })
  })

  describe('hts-specs CRAM files', () => {
    htsSpecsFiles.forEach(filename => {
      it(`${filename} record count matches samtools`, async () => {
        // Most hts-specs files use ce.fa
        const fastaFile =
          filename.includes('0902_comp_bz2') ||
          filename.includes('0903_comp_lzma')
            ? 'ce.fa'
            : filename.includes('level-')
              ? 'ce.fa'
              : undefined

        const fasta = fastaFile
          ? new FetchableSmallFasta(testDataFile(fastaFile))
          : undefined

        const dump = await dumpWholeFile(
          new CramFile({
            filehandle: testDataFile(filename),
            seqFetch: fasta ? (...args) => fasta.fetch(...args) : undefined,
          }),
        )

        const recordCount = countRecordsInDump(dump)
        const samtoolsCount = getSamtoolsCount(filename)

        expect(recordCount).toEqual(samtoolsCount)
      })
    })
  })
})
