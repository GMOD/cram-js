import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { arenaFromReadFeatures } from '../src/cramFile/readFeatureArena.ts'
import CramRecord from '../src/cramFile/record.ts'
import { CraiIndex, IndexedCramFile } from '../src/index.ts'
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
