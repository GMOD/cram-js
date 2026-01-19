import { performance } from 'node:perf_hooks'
import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath = process.argv[2] || './test/data/SRR396637.sorted.clip.cram'
const craiPath = process.argv[3] || `${cramPath}.crai`
const iterations = Number(process.argv[4]) || 10

async function benchmark() {
  console.log('CRAM Parsing Benchmark')
  console.log('='.repeat(50))
  console.log(`File: ${cramPath}`)
  console.log(`Iterations: ${iterations}`)
  console.log('')

  // First, get the range to query
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

  // Warm up (2 iterations)
  console.log('Warming up...')
  for (let i = 0; i < 2; i++) {
    const file = new IndexedCramFile({
      cramPath,
      index: new CraiIndex({ path: craiPath }),
      seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
      checkSequenceMD5: false,
    })
    await file.getRecordsForRange(0, minStart, maxEnd)
  }

  // Benchmark iterations
  console.log('Running benchmark...')
  const times: number[] = []
  let recordCount = 0

  for (let i = 0; i < iterations; i++) {
    // Create fresh instance each time to avoid caching effects
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

    // Verify data integrity by checking a sample
    if (i === 0) {
      const sample = records[0]
      if (!sample || sample.readLength <= 0) {
        throw new Error('Invalid record data')
      }
    }
  }

  // Calculate statistics
  times.sort((a, b) => a - b)
  const min = times[0]!
  const max = times[times.length - 1]!
  const median = times[Math.floor(times.length / 2)]!
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const stdDev = Math.sqrt(
    times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length,
  )

  // Remove outliers (outside 2 stddev) for trimmed mean
  const trimmedTimes = times.filter(t => Math.abs(t - mean) <= 2 * stdDev)
  const trimmedMean =
    trimmedTimes.reduce((a, b) => a + b, 0) / trimmedTimes.length

  console.log('')
  console.log('Results:')
  console.log('-'.repeat(50))
  console.log(`  Records: ${recordCount.toLocaleString()}`)
  console.log(`  Min:     ${min.toFixed(2)} ms`)
  console.log(`  Max:     ${max.toFixed(2)} ms`)
  console.log(`  Median:  ${median.toFixed(2)} ms`)
  console.log(`  Mean:    ${mean.toFixed(2)} ms (±${stdDev.toFixed(2)})`)
  console.log(`  Trimmed: ${trimmedMean.toFixed(2)} ms`)
  console.log('')
  console.log(
    `  Throughput (median): ${(recordCount / (median / 1000)).toFixed(0)} records/sec`,
  )
  console.log(
    `  Throughput (mean):   ${(recordCount / (mean / 1000)).toFixed(0)} records/sec`,
  )

  // Memory
  const mem = process.memoryUsage()
  console.log('')
  console.log(`  Memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB heap`)

  // Output JSON for easy comparison
  console.log('')
  console.log('JSON:')
  console.log(
    JSON.stringify({
      records: recordCount,
      iterations,
      min,
      max,
      median,
      mean,
      stdDev,
      trimmedMean,
      throughputMedian: recordCount / (median / 1000),
      throughputMean: recordCount / (mean / 1000),
    }),
  )
}

benchmark().catch(err => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
