import { expect, test } from 'vitest'

import { dumpWholeFile } from './lib/dumpFile.ts'
import { testDataFile } from './lib/util.ts'
import { CramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'

test('lzma', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hts-specs/0903_comp_lzma.cram'),
    seqFetch,
  })
  const fileData = await dumpWholeFile(file)
  const feat = fileData[2].data[1].features[0]
  const hardClip = feat.readFeatures[0]
  expect(hardClip).toMatchSnapshot()
})

test('bzip2', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('ce.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('hts-specs/0902_comp_bz2.cram'),
    seqFetch,
  })
  const fileData = await dumpWholeFile(file)
  const feat = fileData[2].data[1].features[0]
  const hardClip = feat.readFeatures[0]
  expect(hardClip).toMatchSnapshot()
})

test('test-r4x16 (samtools 1.21 generated)', async () => {
  const file = new CramFile({
    filehandle: testDataFile('test-r4x16.cram'),
  })
  const fileData = await dumpWholeFile(file)
  expect(fileData).toBeDefined()
  expect(fileData.length).toBeGreaterThan(0)
})

test('test-samtools-123 (samtools 1.23.1 with tok3)', async () => {
  // Test file generated with samtools 1.23.1 (htscodecs 1.6.6)
  // Uses multiple compression methods: bzip2, rans, rans4x16, arith, fqzcomp, tok3
  // This verifies cram-js handles the codecs from newer samtools that triggered IGV.js issue #2078
  const file = new CramFile({
    filehandle: testDataFile('test-samtools-123.cram'),
  })
  const fileData = await dumpWholeFile(file)
  expect(fileData).toBeDefined()
  expect(fileData.length).toBeGreaterThan(0)
})
