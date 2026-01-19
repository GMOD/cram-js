import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath =
  process.argv[2] || './test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram'
const craiPath = process.argv[3] || `${cramPath}.crai`

async function analyze() {
  const indexedFile = new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: craiPath }),
    seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })

  const index = await indexedFile.index.getIndex()
  const seqIds = Object.keys(index)

  let allRecords: any[] = []
  for (const seqIdStr of seqIds) {
    const seqId = Number(seqIdStr)
    const entries = index[seqId]
    if (!entries || entries.length === 0) continue

    let minStart = Number.POSITIVE_INFINITY
    let maxEnd = 0
    for (const entry of entries) {
      if (entry.start < minStart) minStart = entry.start
      const end = entry.start + entry.span
      if (end > maxEnd) maxEnd = end
    }

    const records = await indexedFile.getRecordsForRange(
      seqId,
      minStart,
      maxEnd,
    )
    allRecords = allRecords.concat(records)
  }

  console.log('Long-read CRAM Analysis')
  console.log('='.repeat(50))
  console.log(`File: ${cramPath}`)
  console.log(`Total records: ${allRecords.length}`)

  if (allRecords.length === 0) {
    console.log('No records found')
    return
  }

  const readLengths = allRecords.map(r => r.readLength)
  const minLen = Math.min(...readLengths)
  const maxLen = Math.max(...readLengths)
  const avgLen = readLengths.reduce((a, b) => a + b, 0) / readLengths.length
  const totalBases = readLengths.reduce((a, b) => a + b, 0)

  console.log('')
  console.log('Read length statistics:')
  console.log(`  Min:   ${minLen.toLocaleString()} bp`)
  console.log(`  Max:   ${maxLen.toLocaleString()} bp`)
  console.log(`  Avg:   ${avgLen.toFixed(0)} bp`)
  console.log(`  Total: ${totalBases.toLocaleString()} bp`)

  const withQS = allRecords.filter(r => r.qualityScores).length
  const withFeatures = allRecords.filter(r => r.readFeatures).length
  const totalFeatures = allRecords.reduce(
    (sum, r) => sum + (r.readFeatures?.length || 0),
    0,
  )

  console.log('')
  console.log('Record characteristics:')
  console.log(
    `  With quality scores: ${withQS} (${((100 * withQS) / allRecords.length).toFixed(1)}%)`,
  )
  console.log(`  With read features:  ${withFeatures}`)
  console.log(`  Total features:      ${totalFeatures.toLocaleString()}`)

  // Show a few sample records
  console.log('')
  console.log('Sample records (first 5):')
  for (let i = 0; i < Math.min(5, allRecords.length); i++) {
    const r = allRecords[i]
    console.log(
      `  ${i + 1}. ${r.readName || 'unnamed'}: ${r.readLength} bp, ${r.readFeatures?.length || 0} features`,
    )
  }
}

analyze().catch(console.error)
