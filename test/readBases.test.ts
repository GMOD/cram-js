import { expect, test } from 'vitest'

import { arenaFromReadFeatures } from '../src/cramFile/readFeatureArena.ts'
import CramRecord from '../src/cramFile/record.ts'

import type { ReadFeature, RefRegion } from '../src/cramFile/record.ts'

// A 10bp mapped read at ref 101, fully covered by a 10bp reference region.
// readFeatures/lengthOnRef are what each case varies.
function makeRecord(readFeatures: ReadFeature[], lengthOnRef = 10) {
  const arena = arenaFromReadFeatures(readFeatures)
  const record = new CramRecord({
    flags: 0,
    cramFlags: 0,
    readLength: 10,
    mappingQuality: 30,
    lengthOnRef,
    qualityColumn: undefined,
    qualityStart: -1,
    mateRecordNumber: undefined,
    readBases: undefined,
    readFeatureArena: arena,
    readFeatureStart: 0,
    readFeatureCount: arena.length,
    mate: undefined,
    readGroupId: 0,
    readName: undefined,
    sequenceId: 0,
    uniqueId: 1,
    templateSize: undefined,
    start: 101,
    tags: {},
  })
  const refRegion: RefRegion = { start: 101, end: 110, seq: 'ACGTACGTAC' }
  record._refRegion = refRegion
  return record
}

test('reconstructs read bases from substitution features', () => {
  const record = makeRecord([
    { code: 'X', data: 0, pos: 4, refPos: 104, sub: 'T' },
  ])
  expect(record.getReadBases()).toBe('ACGTTCGTAC')
})

// Regression guard: the walk over read features used to spin forever whenever
// an iteration could neither emit a base nor consume a feature. Both dead ends
// are reachable from malformed data and hang hard — the loop is synchronous, so
// the tab/process cannot even be interrupted.
test('throws rather than hanging on two features at one read position', () => {
  // what an FP delta of 0 between two base-consuming features decodes to
  const record = makeRecord([
    { code: 'X', data: 0, pos: 4, refPos: 104, sub: 'T' },
    { code: 'X', data: 0, pos: 4, refPos: 104, sub: 'G' },
  ])
  expect(() => record.getReadBases()).toThrow(/seems malformed/)
})

test('throws rather than hanging when the reference region falls short', () => {
  // a deletion claims 5 reference bases the 10bp region cannot supply on top of
  // the read's own 10, so the trailing reference chunk comes back empty
  const record = makeRecord([{ code: 'D', data: 5, pos: 2, refPos: 102 }], 15)
  expect(() => record.getReadBases()).toThrow(/seems malformed/)
})

// The bytewise reconstruction (long reads) and the string one (short reads) must
// agree exactly. The string form upper-cased the whole read at the end, so every
// byte the bytewise form writes has to be upper-cased as it goes — including the
// two that come from neither the reference nor a payload run. No fixture here
// carries a lowercase substitution or B base, so nothing else would catch it.
test('both reconstructions upper-case every source of bases', () => {
  const features: ReadFeature[] = [
    // lowercase soft clip, verbatim bases, insertion and B base
    { code: 'S', data: 'aa', pos: 0, refPos: 101 },
    { code: 'b', data: 'cc', pos: 2, refPos: 101 },
    { code: 'B', data: ['g', 40], pos: 4, refPos: 103 },
    { code: 'I', data: 'tt', pos: 5, refPos: 104 },
  ]
  const short = makeRecord(features)
  // a lowercase (soft-masked) reference, as a real genome has
  short._refRegion = { start: 101, end: 111, seq: 'acgtacgtac' }
  const shortBases = short.getReadBases()

  // the same record over the byte path, which only runs at length >= 1000
  const long = makeRecord(features)
  long._refRegion = { start: 101, end: 1101, seq: 'acgtacgtac'.repeat(100) }
  long.readLength = 1000
  long.lengthOnRef = 1000
  const longBases = long.getReadBases()!

  // 2 clipped + 2 verbatim + 1 B base + 2 inserted, then reference to fill 10
  expect(shortBases).toBe('AACCGTTTAC')
  // the byte path agrees on every base the features contribute, then takes the
  // reference for the rest — and neither path leaves any lowercase behind
  expect(longBases.slice(0, 7)).toBe(shortBases!.slice(0, 7))
  expect(longBases).toBe(longBases.toUpperCase())
  expect(shortBases).toBe(shortBases!.toUpperCase())
  expect(longBases).toHaveLength(1000)
})

// The two reconstructions in decodeReadSequence — a string for short reads, a
// byte array for long ones — are picked by read length, so only ever one of them
// runs for a given record and a drift between them would hide until a file of
// the other size hit the changed branch. Run the same features through both.
//
// Each case is built twice against the same repeating reference: once short
// enough for the string path, once padded past BYTEWISE_READ_BASES_MIN for the
// byte path. Only the feature-covered prefix is comparable — past it the two
// records take different amounts of reference — but that prefix is where every
// branch lives.
const REF_UNIT = 'acgtACGTns'

function bothPaths(features: ReadFeature[], prefixLength: number) {
  const build = (readLength: number) => {
    const arena = arenaFromReadFeatures(features)
    const record = Object.assign(Object.create(CramRecord.prototype), {
      flags: 0,
      cramFlags: 0,
      start: 101,
      readLength,
      lengthOnRef: readLength,
      readFeatureArena: arena,
      readFeatureStart: 0,
      readFeatureCount: arena.length,
    }) as CramRecord
    record._refRegion = {
      start: 101,
      end: 101 + REF_UNIT.length * 400,
      seq: REF_UNIT.repeat(400),
    }
    return record.getReadBases()!
  }
  return [
    build(prefixLength + 20).slice(0, prefixLength),
    build(2000).slice(0, prefixLength),
  ]
}

test.each([
  ['substitution', [{ code: 'X', data: 0, pos: 3, refPos: 104, sub: 'g' }], 8],
  ['deletion', [{ code: 'D', data: 4, pos: 3, refPos: 104 }], 8],
  ['reference skip', [{ code: 'N', data: 6, pos: 3, refPos: 104 }], 8],
  ['insertion', [{ code: 'I', data: 'tt', pos: 3, refPos: 104 }], 8],
  ['single-base insertion', [{ code: 'i', data: 'a', pos: 3, refPos: 104 }], 8],
  ['soft clip', [{ code: 'S', data: 'cc', pos: 0, refPos: 101 }], 8],
  ['hard clip', [{ code: 'H', data: 5, pos: 0, refPos: 101 }], 8],
  ['padding', [{ code: 'P', data: 2, pos: 3, refPos: 104 }], 8],
  ['verbatim bases', [{ code: 'b', data: 'gg', pos: 3, refPos: 104 }], 8],
  [
    'base plus quality',
    [{ code: 'B', data: ['t', 40], pos: 3, refPos: 104 }],
    8,
  ],
  // A B feature's `num` column holds its *quality score*, not a payload length,
  // so reading its base through the length-sized view handed back an empty one
  // whenever the quality happened to be 0 — and the base decoded as a NUL. Only
  // the string path read it that way, so the two disagreed on nothing else.
  [
    'base plus quality, quality zero',
    [{ code: 'B', data: ['t', 0], pos: 3, refPos: 104 }],
    8,
  ],
  ['quality only', [{ code: 'Q', data: 40, pos: 3, refPos: 104 }], 8],
  [
    'several at once',
    [
      { code: 'S', data: 'cc', pos: 0, refPos: 101 },
      { code: 'X', data: 0, pos: 4, refPos: 104, sub: 'g' },
      { code: 'D', data: 3, pos: 5, refPos: 105 },
      { code: 'I', data: 'tt', pos: 5, refPos: 108 },
    ],
    12,
  ],
] as [string, ReadFeature[], number][])(
  'the string and byte reconstructions agree: %s',
  (_name, features, prefixLength) => {
    const [viaString, viaBytes] = bothPaths(features, prefixLength)
    expect(viaBytes).toBe(viaString)
    // and neither leaves the soft-masked reference lowercase
    expect(viaString).toBe(viaString!.toUpperCase())
  },
)
