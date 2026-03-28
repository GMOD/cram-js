import { readFileSync } from 'node:fs'

const iterations = Number(process.argv[2] || '5')

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

interface BenchCase {
  name: string
  cramPath: string
  seqId: number
  start: number
  end: number
}

const dataDir = '/home/cdiesh/src/jb2profile'

const cases: BenchCase[] = [
  {
    name: '200x shortread (5.7MB)',
    cramPath: `${dataDir}/200x.shortread.cram`,
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: '400x shortread (14MB)',
    cramPath: `${dataDir}/400x.shortread.cram`,
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: '200x longread (35MB)',
    cramPath: `${dataDir}/200x.longread.cram`,
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: '400x longread (70MB)',
    cramPath: `${dataDir}/400x.longread.cram`,
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
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    max: sorted[sorted.length - 1]!,
    mean,
  }
}

async function benchBranch(branchDir: string, c: BenchCase) {
  const mod = await import(`../${branchDir}/index.js`)
  const { IndexedCramFile, CraiIndex } = mod

  // warmup
  const cram0 = new IndexedCramFile({
    cramPath: c.cramPath,
    index: new CraiIndex({ path: `${c.cramPath}.crai` }),
    seqFetch,
    checkSequenceMD5: false,
  })
  const warmupRecords = await cram0.getRecordsForRange(c.seqId, c.start, c.end)
  const recordCount = warmupRecords.length

  if (global.gc) {
    global.gc()
  }

  const timings: number[] = []
  for (let i = 0; i < iterations; i++) {
    if (global.gc) {
      global.gc()
    }
    const start = performance.now()
    const cram = new IndexedCramFile({
      cramPath: c.cramPath,
      index: new CraiIndex({ path: `${c.cramPath}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
    })
    await cram.getRecordsForRange(c.seqId, c.start, c.end)
    timings.push(performance.now() - start)
  }

  return { timings, recordCount }
}

async function main() {
  const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
  const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

  console.log(
    `cram-js large file benchmark - ${iterations} iterations per case`,
  )
  console.log(`  branch1: ${branch1Name}`)
  console.log(`  branch2: ${branch2Name}\n`)

  for (const c of cases) {
    console.log(`--- ${c.name} ---`)
    const r1 = await benchBranch('esm_branch1', c)
    const r2 = await benchBranch('esm_branch2', c)
    const s1 = stats(r1.timings)
    const s2 = stats(r2.timings)
    const ratio = s1.p50 / s2.p50

    console.log(`  ${r1.recordCount} records`)
    console.log(
      `  ${branch1Name.padEnd(20)} p50=${s1.p50.toFixed(0)}ms  mean=${s1.mean.toFixed(0)}ms  min=${s1.min.toFixed(0)}ms  max=${s1.max.toFixed(0)}ms`,
    )
    console.log(
      `  ${branch2Name.padEnd(20)} p50=${s2.p50.toFixed(0)}ms  mean=${s2.mean.toFixed(0)}ms  min=${s2.min.toFixed(0)}ms  max=${s2.max.toFixed(0)}ms`,
    )
    if (ratio > 1.05) {
      console.log(`  => ${branch2Name} is ${ratio.toFixed(2)}x faster (p50)`)
    } else if (ratio < 0.95) {
      console.log(
        `  => ${branch1Name} is ${(1 / ratio).toFixed(2)}x faster (p50)`,
      )
    } else {
      console.log(`  => no significant difference (ratio=${ratio.toFixed(2)})`)
    }
    console.log()
  }
}

main().catch(console.error)
