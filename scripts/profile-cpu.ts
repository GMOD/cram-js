import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'

import { LocalFile } from 'generic-filehandle2'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

const iterations = Number(process.argv[2] || '10')

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start + 1)

interface ProfileCase {
  name: string
  cramPath: string
  seqId: number
  start: number
  end: number
}

const cases: ProfileCase[] = [
  {
    name: 'SRR396637-short-reads',
    cramPath: 'test/data/SRR396637.sorted.clip.cram',
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
  {
    name: 'HG002-long-reads',
    cramPath: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
    seqId: 0,
    start: 0,
    end: 100_000_000,
  },
]

async function profileCase(
  session: Session,
  c: ProfileCase,
) {
  console.log(`Profiling ${c.name}...`)

  // warmup
  for (let i = 0; i < 3; i++) {
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

  await session.post('Profiler.enable')
  await session.post('Profiler.start')

  let recordCount = 0
  for (let i = 0; i < iterations; i++) {
    const cram = new IndexedCramFile({
      cramFilehandle: new LocalFile(c.cramPath),
      index: new CraiIndex({ filehandle: new LocalFile(`${c.cramPath}.crai`) }),
      seqFetch,
      checkSequenceMD5: false,
    })
    const records = await cram.getRecordsForRange(c.seqId, c.start, c.end)
    recordCount = records.length
  }

  const { profile } = await session.post('Profiler.stop')

  const filename = `${c.name}.cpuprofile`
  writeFileSync(filename, JSON.stringify(profile))
  console.log(
    `  Wrote ${filename} (${iterations} iterations, ${recordCount} records)`,
  )
}

async function main() {
  const session = new Session()
  session.connect()

  console.log(`cram-js CPU profiler - ${iterations} iterations per case\n`)
  for (const c of cases) {
    await profileCase(session, c)
  }

  session.disconnect()
  console.log(
    '\nOpen .cpuprofile files in Chrome DevTools (Performance tab) or run:',
  )
  console.log(
    '  node --experimental-strip-types scripts/analyze-profile.ts *.cpuprofile',
  )
}

main().catch(console.error)
