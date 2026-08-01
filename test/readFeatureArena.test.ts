import { expect, test } from 'vitest'

import ReadFeatureArena, {
  RF_DELETION,
  RF_INSERT_BASE,
  RF_SUBST,
  arenaFromReadFeatures,
} from '../src/cramFile/readFeatureArena.ts'
import CramRecord from '../src/cramFile/record.ts'
import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type { ReadFeature } from '../src/cramFile/record.ts'

// one of every code, so the round trip covers all four payload shapes: numeric
// (D/N/H/P/Q), byte-string (I/S/b/i), quality array (q) and base+quality (B)
const allCodes: ReadFeature[] = [
  { code: 'X', data: 2, pos: 0, refPos: 100 },
  { code: 'X', data: 0, pos: 1, refPos: 101, ref: 'A', sub: 'G' },
  { code: 'I', data: 'ACGT', pos: 2, refPos: 102 },
  { code: 'S', data: 'TTT', pos: 3, refPos: 103 },
  { code: 'b', data: 'GG', pos: 4, refPos: 104 },
  { code: 'i', data: 'C', pos: 5, refPos: 105 },
  { code: 'B', data: ['T', 37], pos: 6, refPos: 106 },
  { code: 'q', data: [10, 20, 30], pos: 7, refPos: 107 },
  { code: 'Q', data: 40, pos: 8, refPos: 108 },
  { code: 'D', data: 5, pos: 9, refPos: 109 },
  { code: 'N', data: 60, pos: 10, refPos: 110 },
  { code: 'H', data: 3, pos: 11, refPos: 111 },
  { code: 'P', data: 1, pos: 12, refPos: 112 },
]

test('materialize round-trips every read feature code', () => {
  const arena = arenaFromReadFeatures(allCodes)
  expect(arena.materialize(0, arena.length)).toEqual(allCodes)
})

test('an X feature the reference has not been applied to has no ref/sub keys', () => {
  // the columns store 0 for "not known", and materialize must turn that back
  // into an absent key rather than an explicit undefined, because that is what
  // callers serialising a record have always seen
  const [bare] = arenaFromReadFeatures([allCodes[0]!]).materialize(0, 1)
  expect(Object.keys(bare!).sort()).toEqual(['code', 'data', 'pos', 'refPos'])
})

test('payload accessors read back what was stored', () => {
  const arena = arenaFromReadFeatures(allCodes)
  expect(arena.payloadStringAt(2)).toBe('ACGT')
  expect(arena.num[2]).toBe(4)
  expect([...arena.payloadBytesAt(7)]).toEqual([10, 20, 30])
  // codes are ASCII char codes, which is what consumers switch on
  expect(arena.codes[0]).toBe(RF_SUBST)
  expect(arena.codes[5]).toBe(RF_INSERT_BASE)
  expect(arena.codes[9]).toBe(RF_DELETION)
})

test('columns survive geometric growth past the initial capacity', () => {
  const arena = new ReadFeatureArena(2)
  for (let i = 0; i < 5000; i++) {
    arena.reserve(1)
    arena.codes[i] = RF_INSERT_BASE
    arena.pos[i] = i + 1
    arena.refPos[i] = 1000 + i
    arena.setPayload(i, new Uint8Array([65 + (i % 26)]))
    arena.num[i] = 1
    arena.length = i + 1
  }
  expect(arena.length).toBe(5000)
  expect(arena.pos[4999]).toBe(5000)
  expect(arena.refPos[4999]).toBe(5999)
  expect(arena.payloadStringAt(4999)).toBe(
    String.fromCharCode(65 + (4999 % 26)),
  )
  const before = arena.codes.length
  arena.trim()
  expect(before).toBeGreaterThan(5000)
  expect(arena.codes.length).toBe(5000)
  expect(arena.payloadStringAt(4999)).toBe(
    String.fromCharCode(65 + (4999 % 26)),
  )
})

test('one arena is shared by every record of a slice', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('SRR396636.sorted.clip.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('SRR396636.sorted.clip.cram.crai'),
    }),
    fetchReferenceSequence: async (_id, start, end) =>
      'A'.repeat(end - start + 1),
    checkSequenceMD5: false,
  })
  const records = await cram.getRecordsForRange(0, 0, 100_000_000)
  const withFeatures = records.filter(r => r.readFeatureCount > 0)
  expect(withFeatures.length).toBeGreaterThan(1000)

  // far fewer arenas than records: the columns live on the slice, which is what
  // keeps the fixed typed-array overhead off the ~2-features-per-read case
  const arenas = new Set(withFeatures.map(r => r.readFeatureArena))
  expect(arenas.size).toBeLessThan(withFeatures.length / 100)

  // every record's slot range lies inside its arena, and the ranges tile it
  for (const arena of arenas) {
    const mine = withFeatures.filter(r => r.readFeatureArena === arena)
    let expectedStart = 0
    for (const r of mine) {
      expect(r.readFeatureStart).toBe(expectedStart)
      expectedStart += r.readFeatureCount
    }
    expect(expectedStart).toBe(arena!.length)
  }
})

// The getter has no working setter on purpose — see the comment on it. This
// pins the actionable message, since V8's default only says "has only a getter".
test('assigning readFeatures throws a message pointing at the arena', () => {
  const arena = arenaFromReadFeatures([
    { code: 'X', data: 0, pos: 4, refPos: 104 },
  ])
  const record = Object.assign(Object.create(CramRecord.prototype), {
    flags: 0,
    readLength: 10,
    start: 101,
    readFeatureArena: arena,
    readFeatureStart: 0,
    readFeatureCount: arena.length,
  }) as CramRecord
  expect(record.readFeatures).toHaveLength(1)
  expect(() => {
    // @ts-expect-error deliberately assigning to a read-only accessor
    record.readFeatures = []
  }).toThrow(/read-only.*arenaFromReadFeatures/s)
})
