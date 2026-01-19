import { performance } from 'node:perf_hooks'
import { IndexedCramFile, CraiIndex, CramFile } from '../esm/index.js'

const cramPath = process.argv[2] || './test/data/SRR396637.sorted.clip.cram'
const craiPath = process.argv[3] || `${cramPath}.crai`

interface TimingData {
  name: string
  duration: number
  count?: number
}

const timings: TimingData[] = []

function time<T>(name: string, fn: () => T): T {
  const start = performance.now()
  const result = fn()
  const duration = performance.now() - start
  timings.push({ name, duration })
  return result
}

async function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start
  timings.push({ name, duration })
  return result
}

async function profile() {
  console.log('='.repeat(60))
  console.log('CRAM Performance Profiling')
  console.log('='.repeat(60))
  console.log(`CRAM file: ${cramPath}`)
  console.log(`Index file: ${craiPath}`)
  console.log('')

  // Create the indexed file
  const indexedFile = await timeAsync('Create IndexedCramFile', async () => {
    return new IndexedCramFile({
      cramPath,
      index: new CraiIndex({ path: craiPath }),
      seqFetch: async (_seqId, start, end) => {
        // Return fake sequence for profiling
        return 'A'.repeat(end - start + 1)
      },
      checkSequenceMD5: false,
    })
  })

  // Get SAM header
  const header = await timeAsync(
    'Get SAM header',
    async () => await indexedFile.cram.getSamHeader(),
  )
  console.log(`SAM header has ${header.length} lines`)

  // Get index entries to understand the file structure
  const index = await timeAsync(
    'Parse CRAI index',
    async () => await indexedFile.index.getIndex(),
  )

  // Count total slices
  let totalSlices = 0
  const seqIds = Object.keys(index)
  for (const seqId of seqIds) {
    totalSlices += index[Number(seqId)]?.length || 0
  }
  console.log(`Index has ${seqIds.length} sequences, ${totalSlices} slices`)

  // Profile reading all records for each reference sequence
  console.log('\n--- Reading records by reference sequence ---')
  let totalRecords = 0
  const recordReadTimes: number[] = []

  for (const seqIdStr of seqIds) {
    const seqId = Number(seqIdStr)
    if (seqId < 0) {
      continue
    }

    const entries = index[seqId]
    if (!entries || entries.length === 0) {
      continue
    }

    // Find the full range
    let minStart = Number.POSITIVE_INFINITY
    let maxEnd = 0
    for (const entry of entries) {
      if (entry.start < minStart) {
        minStart = entry.start
      }
      const end = entry.start + entry.span
      if (end > maxEnd) {
        maxEnd = end
      }
    }

    const start = performance.now()
    const records = await indexedFile.getRecordsForRange(
      seqId,
      minStart,
      maxEnd,
    )
    const duration = performance.now() - start

    totalRecords += records.length
    recordReadTimes.push(duration)
    timings.push({
      name: `Read seqId ${seqId} (${minStart}-${maxEnd})`,
      duration,
      count: records.length,
    })

    console.log(
      `  seqId ${seqId}: ${records.length} records in ${duration.toFixed(2)}ms (${(records.length / (duration / 1000)).toFixed(0)} records/sec)`,
    )
  }

  // Profile multiple iterations to get stable measurements
  console.log('\n--- Multiple iteration benchmark ---')
  const iterations = 3
  const iterationTimes: number[] = []

  for (let iter = 0; iter < iterations; iter++) {
    // Clear caches between iterations
    const freshIndexedFile = new IndexedCramFile({
      cramPath,
      index: new CraiIndex({ path: craiPath }),
      seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
      checkSequenceMD5: false,
    })

    const start = performance.now()
    let iterRecords = 0
    for (const seqIdStr of seqIds) {
      const seqId = Number(seqIdStr)
      if (seqId < 0) continue
      const entries = index[seqId]
      if (!entries || entries.length === 0) continue

      let minStart = Number.POSITIVE_INFINITY
      let maxEnd = 0
      for (const entry of entries) {
        if (entry.start < minStart) minStart = entry.start
        const end = entry.start + entry.span
        if (end > maxEnd) maxEnd = end
      }

      const records = await freshIndexedFile.getRecordsForRange(
        seqId,
        minStart,
        maxEnd,
      )
      iterRecords += records.length
    }
    const duration = performance.now() - start
    iterationTimes.push(duration)
    console.log(
      `  Iteration ${iter + 1}: ${iterRecords} records in ${duration.toFixed(2)}ms`,
    )
  }

  const avgIterTime = iterationTimes.reduce((a, b) => a + b, 0) / iterations
  timings.push({
    name: 'Average full read iteration',
    duration: avgIterTime,
    count: iterations,
  })

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total records: ${totalRecords}`)

  const totalReadTime = recordReadTimes.reduce((a, b) => a + b, 0)
  console.log(`Total read time: ${totalReadTime.toFixed(2)}ms`)
  console.log(
    `Throughput: ${(totalRecords / (totalReadTime / 1000)).toFixed(0)} records/sec`,
  )

  console.log('\n--- Timing breakdown ---')
  for (const t of timings) {
    const countStr = t.count !== undefined ? ` (${t.count} items)` : ''
    console.log(`  ${t.name}: ${t.duration.toFixed(2)}ms${countStr}`)
  }

  // Memory usage
  const memUsage = process.memoryUsage()
  console.log('\n--- Memory usage ---')
  console.log(`  Heap used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
  console.log(
    `  Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`)
}

profile().catch(err => {
  console.error('Profiling failed:', err)
  process.exit(1)
})
