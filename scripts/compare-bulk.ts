import { performance } from 'node:perf_hooks'
import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath =
  process.argv[2] || './test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram'
const craiPath = `${cramPath}.crai`
const iterations = 5

async function runBenchmark(label: string) {
  const times: number[] = []
  let recordCount = 0
  let totalBases = 0

  // Get range
  const setupFile = new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: craiPath }),
    seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })
  const index = await setupFile.index.getIndex()
  const entries = index[0] || []
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const entry of entries) {
    if (entry.start < minStart) minStart = entry.start
    const end = entry.start + entry.span
    if (end > maxEnd) maxEnd = end
  }

  // Warm up
  for (let i = 0; i < 2; i++) {
    const file = new IndexedCramFile({
      cramPath,
      index: new CraiIndex({ path: craiPath }),
      seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
      checkSequenceMD5: false,
    })
    await file.getRecordsForRange(0, minStart, maxEnd)
  }

  // Benchmark
  for (let i = 0; i < iterations; i++) {
    const file = new IndexedCramFile({
      cramPath,
      index: new CraiIndex({ path: craiPath }),
      seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
      checkSequenceMD5: false,
    })

    const start = performance.now()
    const records = await file.getRecordsForRange(0, minStart, maxEnd)
    const duration = performance.now() - start

    times.push(duration)
    recordCount = records.length
    if (i === 0) {
      totalBases = records.reduce((sum, r) => sum + r.readLength, 0)
    }
  }

  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]!

  console.log(`${label}:`)
  console.log(`  Median: ${median.toFixed(2)} ms`)
  console.log(
    `  Records: ${recordCount}, Total bases: ${totalBases.toLocaleString()}`,
  )
  console.log(
    `  Throughput: ${(totalBases / (median / 1000) / 1e6).toFixed(2)} Mbp/sec`,
  )
  console.log('')

  return { median, recordCount, totalBases }
}

async function main() {
  console.log('Bulk Decode Comparison')
  console.log('='.repeat(50))
  console.log(`File: ${cramPath}`)
  console.log(`Iterations: ${iterations}`)
  console.log('')

  const result = await runBenchmark('Current (with bulk decode)')

  console.log('Note: To compare with baseline, you would need to')
  console.log('temporarily disable the bulk decode optimization.')
}

main().catch(console.error)
