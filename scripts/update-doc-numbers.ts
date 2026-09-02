// Regenerates the measured tables in docs/memory.md in place.
//
//   pnpm docs:numbers
//
// The docs carry two kinds of number and only one of them rots. A figure like
// "the quality column removed 104 bytes per record, -12.8%" is what a change
// was worth when it landed and stays true forever. A figure like "the ONT slice
// retains 7.10 MB" is a fact about the code as it stands, and goes stale on any
// commit that changes what a record holds — quietly, since nothing recomputes
// it. Every one of those in docs/memory.md had drifted before this script
// existed, by up to 12%, and they are the denominators the rest of the docs
// quote percentages against.
//
// So the second kind lives between GENERATED markers and comes from here.
// Anything outside the markers is written by hand and left alone.
//
// **This is not wired into CI**, deliberately. Retained heap reproduces to
// ±0.2% on one machine but not across V8 versions or machines, so a --check
// gate would fail for reasons that say nothing about the commit under test.
// Run it when you change what a decoded record holds; the version stamp in the
// table is what tells a reader how far back the numbers are from.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const DOC = 'docs/memory.md'
const CASES = ['ONT', 'SRR396636', 'SRR396637'] as const

const version = JSON.parse(readFileSync('package.json', 'utf8')).version

/** one fresh process per fixture, which is what makes the heap figure real */
function run(script: string, args: string[], exposeGc = false) {
  const flags = exposeGc ? ['--expose-gc'] : []
  return execFileSync(
    process.execPath,
    [...flags, '--experimental-strip-types', script, ...args],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  )
}

// one decimal, not two: the heap noise floor is ±0.2%, which is wider than the
// second decimal of a 7 MB figure, so it would flicker and churn the diff on
// every regeneration. The byte counts below are exact and need no such care.
const mb = (n: number) => n.toFixed(1)
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`

console.error(`measuring ${CASES.length} fixtures at v${version}...`)

const heap = CASES.map(name => {
  console.error(`  retained heap: ${name}`)
  return JSON.parse(run('scripts/measure-heap.ts', [name], true).trim())
})

console.error('  arena columns')
const arenas = run('scripts/arena-columns.ts', ['--json'])
  .trim()
  .split('\n')
  .map(line => JSON.parse(line))

const LABELS: Record<string, string> = {
  ONT: 'HG002 ONT (long reads)',
  SRR396636: 'SRR396636 (short reads)',
  SRR396637: 'SRR396637 (short reads)',
}

const stamp = `Measured at **v${version}** — regenerate with \`pnpm docs:numbers\`.`

const retainedTable = [
  stamp,
  '',
  '| file | records | features | retained | JS heap | typed arrays | weighed |',
  '| ---- | ------- | -------- | -------- | ------- | ------------ | ------- |',
  ...heap.map(
    h =>
      `| ${LABELS[h.case]} | ${h.records.toLocaleString()} | ${h.features.toLocaleString()} | **${mb(h.retainedMB)} MB** | ${mb(h.jsHeapMB)} MB | ${mb(h.arrayBufferMB)} MB | ${mb(h.weighedMB)} MB |`,
  ),
].join('\n')

// columns as rows and fixtures as columns: eight columns against three
// fixtures, and the question this answers is always "which column is big on
// long reads", which reads down a column rather than across a row
const COLUMN_ORDER = [
  'codes',
  'pos',
  'refPos',
  'num',
  'payloadChunks',
  'refCodes',
  'subCodes',
  'payloadBytes',
]

const arenaTable = [
  stamp,
  '',
  `| column | ${arenas.map(a => a.name).join(' | ')} |`,
  `| ------ | ${arenas.map(() => '---').join(' | ')} |`,
  ...COLUMN_ORDER.map(
    column =>
      `| \`${column}\` | ${arenas
        .map(a => `${kb(a.bytes[column])} (${pct(a.bytes[column], a.total)})`)
        .join(' | ')} |`,
  ),
  `| **total** | ${arenas.map(a => `**${kb(a.total)}**`).join(' | ')} |`,
  '',
  `| | ${arenas.map(a => a.name).join(' | ')} |`,
  `| --- | ${arenas.map(() => '---').join(' | ')} |`,
  `| features | ${arenas.map(a => a.features.toLocaleString()).join(' | ')} |`,
  `| carrying bytes | ${arenas
    .map(
      a =>
        `${a.withPayload.toLocaleString()} (${pct(a.withPayload, a.features)})`,
    )
    .join(' | ')} |`,
  `| payload indexed | ${arenas.map(a => kb(a.payloadUsed)).join(' | ')} |`,
].join('\n')

function replaceBlock(doc: string, id: string, body: string) {
  const begin = `<!-- BEGIN GENERATED: ${id} -->`
  const end = `<!-- END GENERATED: ${id} -->`
  const from = doc.indexOf(begin)
  const to = doc.indexOf(end)
  if (from === -1 || to === -1) {
    throw new Error(`${DOC} has no ${id} block — expected ${begin} ... ${end}`)
  }
  return `${doc.slice(0, from + begin.length)}\n\n${body}\n\n${doc.slice(to)}`
}

let doc = readFileSync(DOC, 'utf8')
doc = replaceBlock(doc, 'retained-heap', retainedTable)
doc = replaceBlock(doc, 'arena-columns', arenaTable)
writeFileSync(DOC, doc)

console.error(`wrote ${DOC} — run prettier over it`)
