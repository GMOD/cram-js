import { readFileSync } from 'node:fs'

const iterations = Number(process.argv[2] || '20')

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

async function benchBranch(
  branchDir: string,
  c: BenchCase,
) {
  const mod = await import(`../${branchDir}/index.js`)
  const { IndexedCramFile, CraiIndex } = mod

  // warmup
  for (let i = 0; i < 3; i++) {
    const cram = new IndexedCramFile({
      cramPath: c.cramPath,
      index: new CraiIndex({ path: `${c.cramPath}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
    })
    await cram.getRecordsForRange(c.seqId, c.start, c.end)
  }

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

  return timings
}

async function main() {
  const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
  const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

  console.log(
    `cram-js branch comparison - ${iterations} iterations per case`,
  )
  console.log(`  branch1: ${branch1Name}`)
  console.log(`  branch2: ${branch2Name}\n`)

  for (const c of cases) {
    console.log(`--- ${c.name} ---`)
    const t1 = await benchBranch('esm_branch1', c)
    const t2 = await benchBranch('esm_branch2', c)
    const s1 = stats(t1)
    const s2 = stats(t2)
    const ratio = s1.p50 / s2.p50

    console.log(
      `  ${branch1Name.padEnd(20)} p50=${s1.p50.toFixed(1)}ms  mean=${s1.mean.toFixed(1)}ms  min=${s1.min.toFixed(1)}ms  max=${s1.max.toFixed(1)}ms`,
    )
    console.log(
      `  ${branch2Name.padEnd(20)} p50=${s2.p50.toFixed(1)}ms  mean=${s2.mean.toFixed(1)}ms  min=${s2.min.toFixed(1)}ms  max=${s2.max.toFixed(1)}ms`,
    )
    if (ratio > 1.05) {
      console.log(
        `  => ${branch2Name} is ${ratio.toFixed(2)}x faster (p50)`,
      )
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
