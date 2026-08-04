import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { arenaFromReadFeatures } from '../src/cramFile/readFeatureArena.ts'
import CramRecord from '../src/cramFile/record.ts'
import {
  CIGAR_DEL,
  CIGAR_HARD_CLIP,
  CIGAR_INS,
  CIGAR_MATCH,
  CIGAR_OP_CHARS,
  CIGAR_REF_SKIP,
  CIGAR_SOFT_CLIP,
  CraiIndex,
  IndexedCramFile,
} from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type { ReadFeature } from '../src/cramFile/record.ts'

// independent CIGAR generator adapted from cram2sam.ts decodeSeqCigar (minus
// seq reconstruction), used only to cross-check getCigarString(). Neither this
// nor getCigarString() needs the reference sequence, only feature positions.
function referenceCigar(record: CramRecord) {
  let cigar = ''
  const op = 'M'
  let oplen = 0
  let last_pos = record.start
  let seqlen = 0
  if (record.readFeatures !== undefined) {
    for (const feature of record.readFeatures) {
      const { code, refPos } = feature
      if (code !== 'q' && code !== 'Q') {
        const sublen = refPos - last_pos
        seqlen += sublen
        last_pos = refPos
        if (sublen) {
          oplen += sublen
        }
        if (code === 'b') {
          seqlen += feature.data.length
          last_pos += feature.data.length
          oplen += feature.data.length
        } else if (code === 'B' || code === 'X') {
          seqlen += 1
          last_pos++
          oplen++
        } else if (code === 'D' || code === 'N') {
          last_pos += feature.data
          if (oplen) {
            cigar += oplen + op
          }
          cigar += feature.data + code
          oplen = 0
        } else if (code === 'I' || code === 'S') {
          seqlen += feature.data.length
          if (oplen) {
            cigar += oplen + op
          }
          cigar += feature.data.length + code
          oplen = 0
        } else if (code === 'i') {
          seqlen += 1
          if (oplen) {
            cigar += oplen + op
          }
          cigar += '1I'
          oplen = 0
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        } else if (code === 'P' || code === 'H') {
          if (oplen) {
            cigar += oplen + op
            oplen = 0
          }
          cigar += feature.data + code
        }
      }
    }
  }
  if (seqlen !== record.readLength) {
    oplen += record.readLength - seqlen
  }
  if (oplen) {
    cigar += oplen + op
  }
  return cigar
}

// The reference impl above does not coalesce adjacent same-op runs (e.g. two
// '1I' single-base insertions), whereas getCigarString() does. Normalize the
// reference output the same way before comparing.
function coalesce(cigar: string) {
  const merged: [number, string][] = []
  for (const [, len, op] of cigar.matchAll(/(\d+)([A-Z])/g)) {
    const last = merged.at(-1)
    if (last?.[1] === op) {
      last[0] += Number(len)
    } else {
      merged.push([Number(len), op!])
    }
  }
  return merged.map(([len, op]) => `${len}${op}`).join('')
}

const files = [
  // the only fixture here carrying Q features — 44 of them, across 29 records —
  // so the only one that exercises the RF_POSITIONAL skip against real data
  'raw_sorted_duplicates_removed.cram',
  'SRR396636.sorted.clip.cram',
  'SRR396637.sorted.clip.cram',
  'ce#1000.tmp.cram',
  'c1#pad1.3.0.cram',
  'c1#pad2.3.0.cram',
  'c2#pad.3.0.cram',
  'hard_clipping.cram',
]

test.each(files)('getCigarString cross-checks %s', async file => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(file),
    index: new CraiIndex({ filehandle: testDataFile(`${file}.crai`) }),
  })
  const records = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)
  let mapped = 0
  for (const record of records) {
    if (record.isSegmentUnmapped()) {
      expect(record.getCigarString()).toBe('*')
    } else {
      mapped++
      expect(record.getCigarString()).toBe(coalesce(referenceCigar(record)))
    }
  }
  expect(mapped).toBeGreaterThan(0)
})

// golden comparison against htslib: the fixture holds the exact CIGARs that
// `samtools view -T volvox.fa volvox-long-reads-sv.cram` produces, as
// `flag<TAB>pos<TAB>cigar` lines. Regenerate with:
//   samtools view -T volvox.fa volvox-long-reads-sv.cram \
//     | awk -F'\t' '{print $2"\t"$4"\t"$6}' | sort > <golden>
test('getCigarString matches htslib (samtools) output', async () => {
  const golden = readFileSync(
    'test/data/volvox-long-reads-sv.cigars.golden.tsv',
    'utf8',
  )
    .trim()
    .split('\n')

  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('volvox-long-reads-sv.cram'),
    // CIGAR reconstruction never reads the reference, so a stub suffices
    fetchReferenceSequence: async () => 'N'.repeat(100_000),
    index: new CraiIndex({
      filehandle: testDataFile('volvox-long-reads-sv.cram.crai'),
    }),
  })

  const actual: string[] = []
  for (const seqId of [0, 1]) {
    const records = await cram.getRecordsForRange(seqId, 0, 60000)
    for (const record of records) {
      actual.push(
        `${record.flags}\t${record.start + 1}\t${record.getCigarString()}`,
      )
    }
  }
  expect(actual.length).toBe(golden.length)
  expect([...actual].sort()).toEqual([...golden].sort())
})

// build a bare record with just the fields getCigarString() reads, bypassing
// the decode constructor
function makeRecord({
  readFeatures,
  ...fields
}: {
  flags: number
  readLength: number
  start: number
  readFeatures?: ReadFeature[]
}) {
  const arena = readFeatures ? arenaFromReadFeatures(readFeatures) : undefined
  return Object.assign(Object.create(CramRecord.prototype), fields, {
    readFeatureArena: arena,
    readFeatureStart: 0,
    readFeatureCount: arena ? arena.length : 0,
  }) as CramRecord
}

test('read with no features is all matches', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 100,
      start: 4,
    }).getCigarString(),
  ).toBe('100M')
})

test('substitutions stay within the match run', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [{ code: 'X', data: 2, pos: 4, refPos: 4 }],
    }).getCigarString(),
  ).toBe('10M')
})

test('deletion and refskip', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [
        { code: 'D', data: 3, pos: 4, refPos: 4 },
        { code: 'N', data: 100, pos: 4, refPos: 7 },
      ],
    }).getCigarString(),
  ).toBe('4M3D100N6M')
})

test('soft clip, insertion, hard clip', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 20,
      start: 0,
      readFeatures: [
        { code: 'H', data: 5, pos: 0, refPos: 0 },
        { code: 'S', data: 'ACGT', pos: 0, refPos: 0 },
        { code: 'I', data: 'GG', pos: 4, refPos: 4 },
      ],
    }).getCigarString(),
  ).toBe('5H4S4M2I10M')
})

test('coalesces consecutive single-base insertions', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 5,
      start: 0,
      readFeatures: [
        { code: 'i', data: 'A', pos: 2, refPos: 2 },
        { code: 'i', data: 'C', pos: 3, refPos: 2 },
      ],
    }).getCigarString(),
  ).toBe('2M2I1M')
})

// A Q between the two halves of an insertion is what a real decoder produces
// when quality is preserved for one inserted base: 'i' moves refDelta back by
// one, so the Q that follows it reports a refPos behind the insertion. A walk
// that lets Q through flushes the pending insertion here and emits 1I1I.
test('a Q between two single-base insertions does not split them', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 5,
      start: 0,
      readFeatures: [
        { code: 'i', data: 'A', pos: 2, refPos: 2 },
        { code: 'Q', data: 36, pos: 2, refPos: 1 },
        { code: 'i', data: 'C', pos: 3, refPos: 2 },
      ],
    }).getCigarString(),
  ).toBe('2M2I1M')
})

// the same shape around a multi-base insertion, where Q's refPos lands two
// bases behind and would otherwise contribute a negative match run
test('Q features inside an insertion do not perturb the match runs', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [
        { code: 'I', data: 'GG', pos: 4, refPos: 4 },
        { code: 'Q', data: 36, pos: 4, refPos: 2 },
        { code: 'Q', data: 36, pos: 5, refPos: 3 },
      ],
    }).getCigarString(),
  ).toBe('4M2I4M')
})

// htslib's xx#minimal carries five of these: mapped, zero read length, and a
// single zero-length feature, so no operation survives. samtools prints '*'
test('mapped read with no operations returns *', () => {
  expect(
    makeRecord({
      flags: 0x10,
      readLength: 0,
      start: 3,
      readFeatures: [{ code: 'H', data: 0, pos: 0, refPos: 3 }],
    }).getCigarString(),
  ).toBe('*')
})

test('unmapped read returns *', () => {
  expect(
    makeRecord({
      flags: 0x4,
      readLength: 100,
      start: 0,
    }).getCigarString(),
  ).toBe('*')
})

// 'b' is a stretch of verbatim bases that aligns as matches, one M column per
// base — not an insertion, and not something whose `data` length can be ignored
test("'b' verbatim bases align as matches", () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [
        { code: 'b', data: 'ACGT', pos: 0, refPos: 0 },
        { code: 'D', data: 2, pos: 4, refPos: 4 },
      ],
    }).getCigarString(),
  ).toBe('4M2D6M')
})

// insertions consuming every remaining read base leave no trailing match, and
// the run still has to be emitted — a walk that flushes its pending insertion
// only when there are trailing bases left drops them entirely
test('trailing single-base insertions survive with no trailing matches', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 5,
      start: -1,
      readFeatures: [
        { code: 'i', data: 'A', pos: 2, refPos: 2 },
        { code: 'i', data: 'C', pos: 3, refPos: 2 },
      ],
    }).getCigarString(),
  ).toBe('3M2I')
})

// htslib's c2#pad s4, whose CIGAR samtools gives as 4M1I1D1I4M. A walk that
// accumulates single-base insertions and flushes them only on a match region
// merges these two across the deletion and emits them after it, as 4M1D2I4M
test('single-base insertions either side of a deletion stay separate', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [
        { code: 'i', data: 'A', pos: 4, refPos: 4 },
        { code: 'D', data: 1, pos: 5, refPos: 4 },
        { code: 'i', data: 'C', pos: 5, refPos: 5 },
      ],
    }).getCigarString(),
  ).toBe('4M1I1D1I4M')
})

// htslib's xx#minimal a1 (two hard clips, samtools gives 10H) and a2 (hard
// clips around a zero-length insertion and deletion, samtools gives 5H10M5H)
test('zero-length ops are dropped and same-op runs merge', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 0,
      start: 3,
      readFeatures: [
        { code: 'H', data: 5, pos: 0, refPos: 3 },
        { code: 'H', data: 5, pos: 0, refPos: 3 },
      ],
    }).getCigarString(),
  ).toBe('10H')
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 3,
      readFeatures: [
        { code: 'H', data: 5, pos: 0, refPos: 3 },
        { code: 'I', data: '', pos: 0, refPos: 3 },
        { code: 'D', data: 0, pos: 10, refPos: 13 },
        { code: 'H', data: 5, pos: 10, refPos: 13 },
      ],
    }).getCigarString(),
  ).toBe('5H10M5H')
})

// ---------------------------------------------------------------------------
// forEachCigarOp — the walk getCigarString renders. That the walk is *right* is
// what everything above tests; these check the callback contract consumers
// build their own representations on.
// ---------------------------------------------------------------------------

function collectOps(record: CramRecord) {
  const out: [number, number][] = []
  record.forEachCigarOp((op, length) => {
    out.push([op, length])
  })
  return out
}

/** parse a CIGAR string into the same pairs, independently of the walk */
function parseCigar(cigar: string) {
  const out: [number, number][] = []
  for (const [, len, op] of cigar.matchAll(/(\d+)([A-Z=])/g)) {
    out.push([CIGAR_OP_CHARS.indexOf(op!), Number(len)])
  }
  return out
}

test.each(files)(
  'forEachCigarOp emits what getCigarString spells %s',
  async file => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile(file),
      index: new CraiIndex({ filehandle: testDataFile(`${file}.crai`) }),
    })
    const records = await cram.getRecordsForRange(
      0,
      0,
      Number.POSITIVE_INFINITY,
    )
    let checked = 0
    for (const record of records) {
      const ops = collectOps(record)
      const cigar = record.getCigarString()
      if (cigar === '*') {
        expect(ops).toEqual([])
        continue
      }
      checked++
      expect(ops).toEqual(parseCigar(cigar))
      // every op is a real SAM op, no zero-length op survives, and no two
      // consecutive emissions share an op — the run merging is the callback's
      // contract, not something a consumer should have to redo
      for (const [i, [op, length]] of ops.entries()) {
        expect(op).toBeGreaterThanOrEqual(0)
        expect(op).toBeLessThan(CIGAR_OP_CHARS.length)
        expect(length).toBeGreaterThan(0)
        if (i > 0) {
          expect(op).not.toBe(ops[i - 1]![0])
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  },
)

test('unmapped read emits no operations', () => {
  expect(
    collectOps(makeRecord({ flags: 0x4, readLength: 100, start: 0 })),
  ).toEqual([])
})

test('operations are reported with the SAM op numbering', () => {
  const ops = collectOps(
    makeRecord({
      flags: 0,
      readLength: 10,
      start: 0,
      readFeatures: [
        { code: 'S', data: 'AA', pos: 0, refPos: 0 },
        { code: 'I', data: 'GG', pos: 4, refPos: 4 },
        { code: 'D', data: 3, pos: 6, refPos: 6 },
        { code: 'N', data: 2, pos: 6, refPos: 9 },
      ],
    }),
  )
  expect(ops).toEqual([
    [CIGAR_SOFT_CLIP, 2],
    [CIGAR_MATCH, 4],
    [CIGAR_INS, 2],
    [CIGAR_MATCH, 2],
    [CIGAR_DEL, 3],
    [CIGAR_REF_SKIP, 2],
  ])
})

// what a consumer that wants BAM's packed layout does with the walk — the
// point of the callback being the primitive rather than an array this library
// picks the type of
test('packs into BAM-style (length << 4) | op', () => {
  const record = makeRecord({
    flags: 0,
    readLength: 10,
    start: 0,
    readFeatures: [{ code: 'I', data: 'GG', pos: 4, refPos: 4 }],
  })
  const packed: number[] = []
  record.forEachCigarOp((op, length) => {
    packed.push((length << 4) | op)
  })
  expect(packed).toEqual([
    (4 << 4) | CIGAR_MATCH,
    (2 << 4) | CIGAR_INS,
    (4 << 4) | CIGAR_MATCH,
  ])
})

// ---------------------------------------------------------------------------
// getLeadingClipLength / getTrailingClipLength — O(1) answers that must agree
// exactly with reading the first/last operation off the full walk.
// ---------------------------------------------------------------------------

/** the leading clip as reading the first operation off the full walk gives it */
function leadingClipFromWalk(record: CramRecord) {
  const first = collectOps(record)[0]
  return first && (first[0] === CIGAR_SOFT_CLIP || first[0] === CIGAR_HARD_CLIP)
    ? first[1]
    : 0
}

let clippedTotal = 0
test.each(files)(
  'leading clip getter agrees with the CIGAR walk %s',
  async file => {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile(file),
      index: new CraiIndex({ filehandle: testDataFile(`${file}.crai`) }),
    })
    const records = await cram.getRecordsForRange(
      0,
      0,
      Number.POSITIVE_INFINITY,
    )
    let seen = 0
    let clipped = 0
    for (const record of records) {
      const leading = leadingClipFromWalk(record)
      seen++
      if (leading) {
        clipped++
      }
      expect(record.getLeadingClipLength()).toBe(leading)
    }
    expect(seen).toBeGreaterThan(0)
    // not every fixture is clipped, but across the set some must be
    clippedTotal += clipped
  },
)

test('the leading clip getter reports only the first operation', () => {
  // 5H4S… — the leading run is the 5H alone, not 9
  const record = makeRecord({
    flags: 0,
    readLength: 18,
    start: 0,
    readFeatures: [
      { code: 'H', data: 5, pos: 0, refPos: 0 },
      { code: 'S', data: 'AAAA', pos: 0, refPos: 0 },
      { code: 'S', data: 'TTTT', pos: 14, refPos: 10 },
      { code: 'H', data: 5, pos: 18, refPos: 10 },
    ],
  })
  expect(record.getCigarString()).toBe('5H4S10M4S5H')
  expect(record.getLeadingClipLength()).toBe(5)
})

test('every fixture record above was checked, and some were clipped', () => {
  expect(clippedTotal).toBeGreaterThan(0)
})

test('adjacent same-op clips merge, as the CIGAR does', () => {
  const record = makeRecord({
    flags: 0,
    readLength: 0,
    start: 3,
    readFeatures: [
      { code: 'H', data: 5, pos: 0, refPos: 3 },
      { code: 'H', data: 5, pos: 0, refPos: 3 },
    ],
  })
  expect(record.getCigarString()).toBe('10H')
  expect(record.getLeadingClipLength()).toBe(10)
})

test('an unclipped read reports no clip at either end', () => {
  const record = makeRecord({ flags: 0, readLength: 100, start: 4 })
  expect(record.getCigarString()).toBe('100M')
  expect(record.getLeadingClipLength()).toBe(0)
})

test('an unmapped read reports no clip', () => {
  const record = makeRecord({ flags: 0x4, readLength: 100, start: 0 })
  expect(record.getLeadingClipLength()).toBe(0)
})

test('a mid-read soft clip is not the first operation', () => {
  // soft clip mid-read, then more read bases: the CIGAR ends M, not S
  const record = makeRecord({
    flags: 0,
    readLength: 20,
    start: 0,
    readFeatures: [{ code: 'S', data: 'AAAA', pos: 4, refPos: 4 }],
  })
  expect(record.getCigarString()).toBe('4M4S12M')
  expect(record.getLeadingClipLength()).toBe(0)
})
