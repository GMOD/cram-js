import { LocalFile } from 'generic-filehandle2'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

const iterations = Number(process.argv[2] || '10')

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

interface BenchCase {
  name: string
  cramPath: string
  seqId: number
  start: number
  end: number
}

const cases: BenchCase[] = [
  {
    name: 'SRR396637 (2.5MB, short reads)',
    cramPath: 'test/data/SRR396637.sorted.clip.cram',
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: 'HG002 ONT (1.5MB, long reads)',
    cramPath: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: 'ce#1000 (138KB)',
    cramPath: 'test/data/ce#1000.tmp.cram',
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
]

function stats(timings: number[]) {
  const sorted = [...timings].sort((a, b) => a - b)
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length
  return {
    min: sorted[0]!,
    p25: sorted[Math.floor(sorted.length * 0.25)]!,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p75: sorted[Math.floor(sorted.length * 0.75)]!,
    max: sorted[sorted.length - 1]!,
    mean,
  }
}

async function benchCase(c: BenchCase) {
  const warmup = 3
  for (let i = 0; i < warmup; i++) {
    const cram = new IndexedCramFile({
      cramFilehandle: new LocalFile(c.cramPath),
      index: new CraiIndex({ filehandle: new LocalFile(`${c.cramPath}.crai`) }),
      seqFetch,
      checkSequenceMD5: false,
    })
    await cram.getRecordsForRange(c.seqId, c.start, c.end)
  }

  if (global.gc) {
    global.gc()
  }

  const timings: number[] = []
  let recordCount = 0
  for (let i = 0; i < iterations; i++) {
    if (global.gc) {
      global.gc()
    }
    const start = performance.now()
    const cram = new IndexedCramFile({
      cramFilehandle: new LocalFile(c.cramPath),
      index: new CraiIndex({ filehandle: new LocalFile(`${c.cramPath}.crai`) }),
      seqFetch,
      checkSequenceMD5: false,
    })
    const records = await cram.getRecordsForRange(c.seqId, c.start, c.end)
    timings.push(performance.now() - start)
    recordCount = records.length
  }

  const s = stats(timings)
  console.log(`${c.name} (${iterations} runs, ${recordCount} records):`)
  console.log(
    `  min=${s.min.toFixed(1)}ms  p25=${s.p25.toFixed(1)}ms  p50=${s.p50.toFixed(1)}ms  p75=${s.p75.toFixed(1)}ms  max=${s.max.toFixed(1)}ms  mean=${s.mean.toFixed(1)}ms`,
  )
  console.log(`  all: [${timings.map(t => t.toFixed(1)).join(', ')}]`)
}

async function main() {
  console.log(`cram-js benchmark (source) - ${iterations} iterations\n`)
  for (const c of cases) {
    await benchCase(c)
    console.log()
  }
}

main().catch(console.error)
