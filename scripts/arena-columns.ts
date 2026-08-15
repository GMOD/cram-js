// What each read-feature arena column costs, and how much of it is doing
// anything. The companion to measure-heap.ts: that one weighs a decoded slice
// from outside, this one takes the arena apart.
//
//   node --experimental-strip-types scripts/arena-columns.ts [case]
//
// `case` is a substring of one of the names below; omit it for all of them.
// See the payloadOffsets item in TODO.md for what the numbers settled.
import { LocalFile } from 'generic-filehandle2'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

import type ReadFeatureArena from '../src/cramFile/readFeatureArena.ts'

const cases = [
  { name: 'ONT', path: 'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram' },
  { name: 'SRR396636', path: 'test/data/SRR396636.sorted.clip.cram' },
  { name: 'SRR396637', path: 'test/data/SRR396637.sorted.clip.cram' },
]

const COLUMNS = [
  'codes',
  'pos',
  'refPos',
  'num',
  'payloadChunks',
  'refCodes',
  'subCodes',
  'payloadBytes',
] as const

/** the codes whose payload is bytes in `payloadBytes` rather than a number */
const PAYLOAD_CODES = new Set(['I', 'S', 'b', 'i', 'q', 'B'])

const which = process.argv[2]
const selected = which ? cases.filter(c => c.name.includes(which)) : cases
if (selected.length === 0) {
  throw new Error(`unknown case ${which}`)
}

const seqFetch = async (_seqId: number, start: number, end: number) =>
  'A'.repeat(end - start)

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`

for (const c of selected) {
  const cram = new IndexedCramFile({
    cramFilehandle: new LocalFile(c.path),
    index: new CraiIndex({ filehandle: new LocalFile(`${c.path}.crai`) }),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
  const records = await cram.getRecordsForRange(0, 0, 100_000_000)

  // one arena per slice, and a record points at its own, so dedupe by identity
  const arenas = new Set<ReadFeatureArena>()
  for (const record of records) {
    if (record.readFeatureArena) {
      arenas.add(record.readFeatureArena)
    }
  }

  const bytes: Record<string, number> = {}
  const byCode: Record<string, number> = {}
  let features = 0
  let withPayload = 0
  let payloadUsed = 0
  // the column is only redundant if it really is the running prefix sum of the
  // lengths already in `code` and `num`, so check rather than assume
  let notPrefixSum = 0

  for (const arena of arenas) {
    features += arena.length
    payloadUsed += arena.payloadLength
    for (const column of COLUMNS) {
      bytes[column] = (bytes[column] ?? 0) + arena[column].byteLength
    }
    let running = 0
    for (let i = 0; i < arena.length; i++) {
      const code = String.fromCharCode(arena.codes[i]!)
      byCode[code] = (byCode[code] ?? 0) + 1
      if (PAYLOAD_CODES.has(code)) {
        withPayload++
        if (arena.payloadOffsetAt(i) !== running) {
          notPrefixSum++
        }
        // B carries exactly one byte; for the rest `num` is the payload length
        running += code === 'B' ? 1 : arena.num[i]!
      }
    }
  }

  const total = Object.values(bytes).reduce((a, b) => a + b, 0)
  console.log(
    `\n${c.name}: ${records.length} records, ${arenas.size} arena(s), ${features} features`,
  )
  for (const column of COLUMNS) {
    const n = bytes[column]!
    console.log(
      `  ${column.padEnd(15)}${kb(n).padStart(10)}  ${((100 * n) / total).toFixed(1)}%`,
    )
  }
  console.log(`  ${'total'.padEnd(15)}${kb(total).padStart(10)}`)
  console.log(
    `  by code: ${Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${code}=${n}`)
      .join(' ')}`,
  )
  console.log(
    `  slots carrying bytes: ${withPayload} of ${features} (${((100 * withPayload) / features).toFixed(1)}%), indexing ${kb(payloadUsed)}`,
  )
  // payloadOffsetAt derives each offset from the checkpoints, so this is also
  // the check that the derivation agrees with the appends it is derived from
  console.log(`  offsets that are not the prefix sum: ${notPrefixSum}`)
}
