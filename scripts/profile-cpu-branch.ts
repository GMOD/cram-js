import { writeFileSync, readFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'

const branch = process.argv[2] || '1'
const iterations = Number(process.argv[3] || '20')

const branchDir = branch === '1' ? 'esm_branch1' : 'esm_branch2'
const branchName = readFileSync(`${branchDir}/branchname.txt`, 'utf8').trim()

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

async function profileCase(session: Session, c: ProfileCase) {
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

  await session.post('Profiler.enable')
  await session.post('Profiler.start')

  let recordCount = 0
  for (let i = 0; i < iterations; i++) {
    const cram = new IndexedCramFile({
      cramPath: c.cramPath,
      index: new CraiIndex({ path: `${c.cramPath}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
    })
    const records = await cram.getRecordsForRange(c.seqId, c.start, c.end)
    recordCount = records.length
  }

  const { profile } = await session.post('Profiler.stop')

  const filename = `${c.name}-${branchName}.cpuprofile`
  writeFileSync(filename, JSON.stringify(profile))
  console.log(
    `  Wrote ${filename} (${iterations} iters, ${recordCount} records)`,
  )
}

async function main() {
  const session = new Session()
  session.connect()

  console.log(
    `Profiling ${branchName} (${branchDir}) - ${iterations} iterations\n`,
  )
  for (const c of cases) {
    console.log(`Profiling ${c.name}...`)
    await profileCase(session, c)
  }

  session.disconnect()
}

main().catch(console.error)
