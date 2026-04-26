/**
 * Combined timing + CPU profiler for cram-js source.
 *
 * Usage:
 *   node --expose-gc --experimental-strip-types scripts/profile-large.ts [cramPath] [iterations]
 *
 * If cramPath is omitted, falls back to the largest available test files.
 * Writes a <name>.cpuprofile that can be opened in Chrome DevTools or
 * analyzed with: node --experimental-strip-types scripts/analyze-profile.ts *.cpuprofile
 */

import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'

import { LocalFile } from 'generic-filehandle2'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

interface Case {
  name: string
  cramPath: string
  craiPath: string
  seqId: number
  start: number
  end: number
}

function defaultCases(): Case[] {
  return [
    {
      name: 'SRR396637-shortread-2.5MB',
      cramPath: 'test/data/SRR396637.sorted.clip.cram',
      craiPath: 'test/data/SRR396637.sorted.clip.cram.crai',
      seqId: 0,
      start: 0,
      end: 100_000_000,
    },
    {
      name: 'HG002-longread-1.5MB',
      cramPath: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
      craiPath: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram.crai',
      seqId: 0,
      start: 0,
      end: 100_000_000,
    },
  ]
}

function stats(timings: number[]) {
  const sorted = [...timings].sort((a, b) => a - b)
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length
  return {
    min: sorted[0]!,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p75: sorted[Math.floor(sorted.length * 0.75)]!,
    max: sorted[sorted.length - 1]!,
    mean,
  }
}

function makeCram(c: Case) {
  return new IndexedCramFile({
    cramFilehandle: new LocalFile(c.cramPath),
    index: new CraiIndex({ filehandle: new LocalFile(c.craiPath) }),
    seqFetch,
    checkSequenceMD5: false,
  })
}

async function run(c: Case, iterations: number) {
  console.log(`\n=== ${c.name} ===`)

  // warmup — lets V8 JIT compile the hot paths before we measure
  for (let i = 0; i < 3; i++) {
    await makeCram(c).getRecordsForRange(c.seqId, c.start, c.end)
  }
  if (global.gc) {
    global.gc()
  }

  // CPU profile covers the timed iterations
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.start')

  const timings: number[] = []
  let recordCount = 0
  for (let i = 0; i < iterations; i++) {
    if (global.gc) {
      global.gc()
    }
    const t0 = performance.now()
    const records = await makeCram(c).getRecordsForRange(
      c.seqId,
      c.start,
      c.end,
    )
    timings.push(performance.now() - t0)
    recordCount = records.length
  }

  const { profile } = await session.post('Profiler.stop')
  session.disconnect()

  const profileFile = `${c.name}.cpuprofile`
  writeFileSync(profileFile, JSON.stringify(profile))

  const s = stats(timings)
  console.log(`  records: ${recordCount}  iterations: ${iterations}`)
  console.log(
    `  min=${s.min.toFixed(0)}ms  p50=${s.p50.toFixed(0)}ms  p75=${s.p75.toFixed(0)}ms  max=${s.max.toFixed(0)}ms  mean=${s.mean.toFixed(0)}ms`,
  )
  console.log(
    `  records/sec: ${((recordCount * 1000) / s.p50).toFixed(0)}  ms/record: ${(s.p50 / recordCount).toFixed(3)}`,
  )
  console.log(`  cpuprofile: ${profileFile}`)
}

async function main() {
  const [cramArg, iterArg] = process.argv.slice(2)
  const iterations = iterArg
    ? Number(iterArg)
    : cramArg?.match(/^\d+$/)
      ? Number(cramArg)
      : 5

  let cases: Case[]
  if (cramArg && !cramArg.match(/^\d+$/)) {
    const cramPath = cramArg
    const craiPath = `${cramPath}.crai`
    const name = cramPath
      .split('/')
      .pop()!
      .replace(/\.cram$/, '')
    cases = [{ name, cramPath, craiPath, seqId: 0, start: 0, end: 100_000_000 }]
  } else {
    cases = defaultCases()
  }

  console.log(
    `cram-js profiler (source) — ${iterations} iterations after 3 warmups`,
  )
  for (const c of cases) {
    await run(c, iterations)
  }
  console.log(
    '\nAnalyze profiles: node --experimental-strip-types scripts/analyze-profile.ts *.cpuprofile',
  )
}

main().catch(console.error)
