import { expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src'
import { testDataFile } from './lib/util'

test('investigate SRR396636 boundary issue', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
    }),
  })

  // Test query: 0-based (25999, 26499)
  // This should match samtools 1-based range 26000-26499 which reports 407 records
  const features = await cram.getRecordsForRange(0, 25999, 26499)

  console.log('Total records:', features.length)
  console.log('Samtools 1-based 26000-26499:', 407)
  console.log('Difference:', features.length - 407)

  console.log('\nFirst 5 records:')
  features.slice(0, 5).forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef : f.alignmentStart
    console.log(`  POS: ${f.alignmentStart}, lengthOnRef: ${f.lengthOnRef}, end: ${end}`)
  })

  console.log('\nLast 5 records:')
  features.slice(-5).forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef : f.alignmentStart
    console.log(`  POS: ${f.alignmentStart}, lengthOnRef: ${f.lengthOnRef}, end: ${end}`)
  })

  // Check records starting before 25999 (0-based) = before 26000 (1-based)
  console.log('\nRecords starting before 25999 (should overlap into range):')
  const beforeStart = features.filter(f => f.alignmentStart < 25999)
  console.log('  Count:', beforeStart.length)
  beforeStart.slice(0, 5).forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef : f.alignmentStart
    console.log(`  POS: ${f.alignmentStart}, lengthOnRef: ${f.lengthOnRef}, end: ${end}, overlaps: ${end > 25999}`)
  })

  // Check records starting at or after 26500 (0-based) = 26501+ (1-based)
  console.log('\nRecords starting at or after 26500 (should NOT be in range):')
  const afterEnd = features.filter(f => f.alignmentStart >= 26500)
  console.log('  Count:', afterEnd.length)
  afterEnd.slice(0, 5).forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef : f.alignmentStart
    console.log(`  POS: ${f.alignmentStart}, lengthOnRef: ${f.lengthOnRef}, end: ${end}`)
  })

  console.log('\nRecords with lengthOnRef undefined (unmapped):')
  const unmapped = features.filter(f => f.lengthOnRef === undefined)
  console.log('  Count:', unmapped.length)
  unmapped.forEach(f => {
    console.log(`  POS: ${f.alignmentStart}, flags: ${f.flags}`)
  })

  // The query is 0-based half-open [25999, 26500), equivalent to 1-based [26000, 26499]
  // Samtools reports 407 records for NC_002516.2:26000-26499
  expect(features.length).toEqual(407)
})
