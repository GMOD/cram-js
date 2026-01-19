import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath = './test/data/SRR396637.sorted.clip.cram'
const craiPath = `${cramPath}.crai`

async function run() {
  const indexedFile = new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: craiPath }),
    seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })

  const index = await indexedFile.index.getIndex()
  const entries = index[0] || []

  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const entry of entries) {
    if (entry.start < minStart) minStart = entry.start
    const end = entry.start + entry.span
    if (end > maxEnd) maxEnd = end
  }

  const records = await indexedFile.getRecordsForRange(0, minStart, maxEnd)

  // Analyze records to estimate call patterns
  let totalReadLen = 0
  let withQualScores = 0
  let withReadFeatures = 0
  let totalFeatures = 0
  let unmappedReads = 0

  for (const r of records) {
    totalReadLen += r.readLength
    if (r.qualityScores) withQualScores++
    if (r.readFeatures) {
      withReadFeatures++
      totalFeatures += r.readFeatures.length
    }
    if (r.isSegmentUnmapped()) unmappedReads++
  }

  console.log('Record Analysis:')
  console.log(`  Total records: ${records.length.toLocaleString()}`)
  console.log(`  Total read length: ${totalReadLen.toLocaleString()} bp`)
  console.log(
    `  Average read length: ${(totalReadLen / records.length).toFixed(1)} bp`,
  )
  console.log(
    `  Records with quality scores: ${withQualScores.toLocaleString()} (${((100 * withQualScores) / records.length).toFixed(1)}%)`,
  )
  console.log(
    `  Records with read features: ${withReadFeatures.toLocaleString()}`,
  )
  console.log(`  Total read features: ${totalFeatures.toLocaleString()}`)
  console.log(`  Unmapped reads: ${unmappedReads.toLocaleString()}`)
  console.log('')

  // Estimate decode calls based on CRAM structure
  // Per record (mapped): BF, CF, RL, AP, RG, TL, FN, MQ = 8 int decodes minimum
  // Plus: per feature (FC=byte, FP=int, + feature-specific)
  // Plus: QS per base if quality preserved
  // Plus: BA per base if unmapped
  const baseIntCallsPerRecord = 8
  const estimatedIntCalls =
    records.length * baseIntCallsPerRecord + totalFeatures * 2
  const estimatedByteCalls =
    withQualScores * (totalReadLen / records.length) +
    totalFeatures + // FC byte per feature
    unmappedReads * (totalReadLen / records.length) // BA bytes for unmapped

  console.log('Estimated decode() calls:')
  console.log(`  Int decodes (ITF8): ~${estimatedIntCalls.toLocaleString()}`)
  console.log(
    `  Byte decodes: ~${Math.round(estimatedByteCalls).toLocaleString()}`,
  )
  console.log(
    `  Total: ~${(estimatedIntCalls + estimatedByteCalls).toLocaleString()}`,
  )
  console.log(
    `  Per record: ~${((estimatedIntCalls + estimatedByteCalls) / records.length).toFixed(1)}`,
  )
}

run().catch(console.error)
