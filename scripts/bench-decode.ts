// Self-contained decode benchmark running against the CRAM files in test/data.
// Unlike scripts/bench-large.ts (which compares two built branches against
// external data), this runs the TypeScript sources directly, so it works in a
// fresh checkout:
//
//   node --experimental-strip-types scripts/bench-decode.ts --json before.json
//   ...make changes...
//   node --experimental-strip-types scripts/bench-decode.ts --compare before.json
//
// Run with --expose-gc for stable memory numbers.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import CraiIndex from '../src/craiIndex.ts'
import CramFile from '../src/cramFile/file.ts'
import IndexedCramFile from '../src/indexedCramFile.ts'
import { LocalFile } from '../src/io.ts'

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? '7')
const DATA = 'test/data'

interface Result {
  name: string
  unit: string
  p50: number
  mean: number
  min: number
  heapMb?: number
  detail?: string
}

function stats(timings: number[]) {
  const sorted = [...timings].sort((a, b) => a - b)
  return {
    min: sorted[0]!,
    p50: sorted[Math.floor(sorted.length / 2)]!,
    mean: timings.reduce((a, b) => a + b, 0) / timings.length,
  }
}

function collectGarbage() {
  if (globalThis.gc) {
    globalThis.gc()
  }
}

async function time(
  name: string,
  fn: () => Promise<string | undefined>,
): Promise<Result> {
  const detail = await fn() // warmup, also reports what the case covers
  collectGarbage()
  const heapBefore = process.memoryUsage().heapUsed
  const timings: number[] = []
  let heapPeak = 0
  for (let i = 0; i < ITERATIONS; i++) {
    collectGarbage()
    const start = performance.now()
    await fn()
    timings.push(performance.now() - start)
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed - heapBefore)
  }
  return {
    name,
    unit: 'ms',
    ...stats(timings),
    heapMb: heapPeak / 1e6,
    detail,
  }
}

// reference sequence stand-in: the real bases do not affect decode cost, but
// providing a callback exercises the read-feature/substitution decode paths
const seqFetch = async (_seqId: number, start: number, end: number) =>
  'ACGT'.repeat(Math.ceil((end - start + 1) / 4)).slice(0, end - start + 1)

async function benchIndexed(name: string, cram: string, crai: string) {
  return time(name, async () => {
    const file = new IndexedCramFile({
      cramFilehandle: new LocalFile(`${DATA}/${cram}`),
      index: new CraiIndex({ filehandle: new LocalFile(`${DATA}/${crai}`) }),
      seqFetch,
      checkSequenceMD5: false,
    })
    const records = await file.getRecordsForRange(
      0,
      0,
      Number.POSITIVE_INFINITY,
    )
    return `${records.length} records`
  })
}

async function benchWholeFile(name: string, cram: string) {
  return time(name, async () => {
    const file = new CramFile({
      filehandle: new LocalFile(`${DATA}/${cram}`),
      seqFetch,
      checkSequenceMD5: false,
    })
    let total = 0
    let containerNumber = 1 // container 0 holds the SAM header
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const container = await file.getContainerById(containerNumber)
      if (!container) {
        break
      }
      const header = await container.getHeader()
      if (!header.numRecords) {
        break
      }
      for (let i = 0; i < header.numLandmarks; i++) {
        const slice = container.getSlice(header.landmarks[i]!, 0)
        total += (await slice.getAllRecords()).length
      }
      containerNumber++
    }
    return `${total} records`
  })
}

// The .crai files in test/data are tiny (largest is 18KB); real whole-genome
// indexes run to tens of MB, so synthesize one to measure index parsing at a
// realistic scale.
async function benchCraiParse(lines: number) {
  const dir = mkdtempSync(join(tmpdir(), 'cram-bench-'))
  const path = join(dir, 'synthetic.crai')
  const parts: string[] = []
  for (let i = 0; i < lines; i++) {
    parts.push(`${i % 24}\t${i * 1000}\t1000\t${i * 20000}\t0\t${12345 + i}\n`)
  }
  const text = parts.join('')
  writeFileSync(path, text)
  try {
    return await time(
      `crai parse (${lines} lines, ${(text.length / 1e6).toFixed(1)}MB)`,
      async () => {
        const index = await new CraiIndex({
          filehandle: new LocalFile(path),
        }).getIndex()
        return `${Object.keys(index).length} sequences`
      },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const results: Result[] = [
    await benchIndexed(
      'ONT long reads (indexed, 1.5MB)',
      'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
      'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram.crai',
    ),
    await benchWholeFile(
      'ONT long reads (whole file)',
      'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
    ),
    await benchWholeFile(
      'SRR396636 short reads (1.2MB)',
      'SRR396636.sorted.clip.cram',
    ),
    await benchWholeFile(
      'SRR396637 short reads (2.5MB)',
      'SRR396637.sorted.clip.cram',
    ),
    await benchCraiParse(500_000),
  ]

  const jsonFlag = process.argv.indexOf('--json')
  const compareFlag = process.argv.indexOf('--compare')

  const nameWidth = Math.max(...results.map(r => r.name.length))
  console.log(
    `cram-js decode benchmark — ${ITERATIONS} iterations${globalThis.gc ? '' : ' (run with --expose-gc for memory numbers)'}\n`,
  )
  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(nameWidth)}  p50=${r.p50.toFixed(1).padStart(8)}ms  mean=${r.mean.toFixed(1).padStart(8)}ms  heap=${(r.heapMb ?? 0).toFixed(1).padStart(6)}MB  ${r.detail ?? ''}`,
    )
  }

  if (compareFlag !== -1) {
    const baselinePath = process.argv[compareFlag + 1]!
    const baseline: Result[] = JSON.parse(
      await import('node:fs').then(fs => fs.readFileSync(baselinePath, 'utf8')),
    )
    console.log('\n  vs baseline:')
    for (const r of results) {
      const b = baseline.find(x => x.name === r.name)
      if (b) {
        const ratio = b.p50 / r.p50
        const verdict =
          ratio > 1.02
            ? `${ratio.toFixed(2)}x faster`
            : ratio < 0.98
              ? `${(1 / ratio).toFixed(2)}x SLOWER`
              : 'no change'
        console.log(
          `  ${r.name.padEnd(nameWidth)}  ${b.p50.toFixed(1)}ms -> ${r.p50.toFixed(1)}ms  ${verdict}   heap ${(b.heapMb ?? 0).toFixed(1)}MB -> ${(r.heapMb ?? 0).toFixed(1)}MB`,
        )
      }
    }
  }

  if (jsonFlag !== -1) {
    writeFileSync(process.argv[jsonFlag + 1]!, JSON.stringify(results, null, 2))
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
