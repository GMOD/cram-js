import { expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src'
import { testDataFile } from './lib/util'

test('investigate coordinate systems', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
    }),
  })

  // Get all reads from a wide range
  const features = await cram.getRecordsForRange(0, 25890, 25920)

  console.log('Reads in range 25890-25920 (0-based query):')
  features.forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef - 1 : f.alignmentStart
    console.log(`  alignmentStart: ${f.alignmentStart} (1-based: ${f.alignmentStart + 1}), lengthOnRef: ${f.lengthOnRef}, end 0-based: ${end}, end 1-based: ${end + 1}`)
  })
})

test('check specific boundary reads', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
    }),
  })

  // Query for range [25999, 26500) in 0-based
  const features = await cram.getRecordsForRange(0, 25999, 26500)

  console.log('\nChecking reads at boundary positions:')

  // Find reads that might be at the boundary
  const boundaryReads = features.filter(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef - 1 : f.alignmentStart
    return f.alignmentStart <= 25900 || end <= 26000
  })

  console.log(`Found ${boundaryReads.length} reads near start boundary`)
  boundaryReads.slice(0, 10).forEach(f => {
    const end = f.lengthOnRef !== undefined ? f.alignmentStart + f.lengthOnRef - 1 : f.alignmentStart
    console.log(`  Start: ${f.alignmentStart} (1-based: ${f.alignmentStart + 1}), Len: ${f.lengthOnRef}, End 0-based: ${end}, End 1-based: ${end + 1}`)
  })
})
