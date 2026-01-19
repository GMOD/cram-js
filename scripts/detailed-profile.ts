import { performance } from 'node:perf_hooks'
import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath = process.argv[2] || './test/data/SRR396637.sorted.clip.cram'
const craiPath = process.argv[3] || `${cramPath}.crai`

async function profile() {
  console.log('Detailed CRAM Profiling')
  console.log('='.repeat(60))

  const indexedFile = new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: craiPath }),
    seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })

  // Get index to find range
  const index = await indexedFile.index.getIndex()
  const seqIds = Object.keys(index)

  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const seqIdStr of seqIds) {
    const entries = index[Number(seqIdStr)]
    if (!entries) continue
    for (const entry of entries) {
      if (entry.start < minStart) minStart = entry.start
      const end = entry.start + entry.span
      if (end > maxEnd) maxEnd = end
    }
  }

  console.log(`Range: ${minStart}-${maxEnd}`)

  // Warm up
  await indexedFile.getRecordsForRange(0, minStart, maxEnd)

  // Clear cache and run fresh
  const freshFile = new IndexedCramFile({
    cramPath,
    index: new CraiIndex({ path: craiPath }),
    seqFetch: async (_seqId, start, end) => 'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })

  console.log('\nRunning 5 iterations...')
  const times: number[] = []

  for (let i = 0; i < 5; i++) {
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
    console.log(
      `  Iteration ${i + 1}: ${records.length} records in ${duration.toFixed(2)}ms`,
    )
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)

  console.log(
    `\nAverage: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`,
  )

  // Memory
  const mem = process.memoryUsage()
  console.log(
    `\nMemory: Heap ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`,
  )
}

profile().catch(console.error)
