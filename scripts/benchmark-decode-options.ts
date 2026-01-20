import { performance } from 'node:perf_hooks'
import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath = process.argv[2] || './test/data/SRR396637.sorted.clip.cram'
const craiPath = `${cramPath}.crai`
const iterations = 5

async function runBenchmark(label: string, decodeQualityScores: boolean) {
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
    await file.getRecordsForRange(0, minStart, maxEnd, { decodeQualityScores })
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
    const records = await file.getRecordsForRange(0, minStart, maxEnd, {
      decodeQualityScores,
    })
    const duration = performance.now() - start

    times.push(duration)
    recordCount = records.length
    if (i === 0) {
      totalBases = records.reduce((sum, r) => sum + r.readLength, 0)
      // Verify QS presence
      const withQS = records.filter(r => r.qualityScores).length
      console.log(`  [${label}] Records with QS: ${withQS}/${records.length}`)
    }
  }

  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]!
  const mean = times.reduce((a, b) => a + b, 0) / times.length

  return { label, median, mean, recordCount, totalBases }
}

async function main() {
  console.log('Decode Options Benchmark')
  console.log('='.repeat(60))
  console.log(`File: ${cramPath}`)
  console.log(`Iterations: ${iterations}`)
  console.log('')

  const withQS = await runBenchmark('With QS', true)
  const withoutQS = await runBenchmark('Without QS', false)

  console.log('')
  console.log('Results:')
  console.log('-'.repeat(60))
  console.log(
    `With QS:    Median ${withQS.median.toFixed(2)}ms, ${(withQS.recordCount / (withQS.median / 1000)).toFixed(0)} rec/s`,
  )
  console.log(
    `Without QS: Median ${withoutQS.median.toFixed(2)}ms, ${(withoutQS.recordCount / (withoutQS.median / 1000)).toFixed(0)} rec/s`,
  )
  console.log('')
  const improvement = (
    ((withQS.median - withoutQS.median) / withQS.median) *
    100
  ).toFixed(1)
  console.log(`Improvement: ${improvement}% faster without QS decoding`)

  // Memory comparison
  console.log('')
  console.log('Memory usage:')
  const memBefore = process.memoryUsage()
  console.log(`  Heap: ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)} MB`)
}

main().catch(console.error)
