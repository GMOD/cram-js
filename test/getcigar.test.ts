import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

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
  let last_pos = record.alignmentStart
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
    seqFetch: async () => 'N'.repeat(100_000),
    index: new CraiIndex({
      filehandle: testDataFile('volvox-long-reads-sv.cram.crai'),
    }),
  })

  const actual: string[] = []
  for (const seqId of [0, 1]) {
    const records = await cram.getRecordsForRange(seqId, 0, 60000)
    for (const record of records) {
      actual.push(
        `${record.flags}\t${record.alignmentStart}\t${record.getCigarString()}`,
      )
    }
  }
  expect(actual.length).toBe(golden.length)
  expect([...actual].sort()).toEqual([...golden].sort())
})

// build a bare record with just the fields getCigarString() reads, bypassing
// the decode constructor
function makeRecord(fields: {
  flags: number
  readLength: number
  alignmentStart: number
  readFeatures?: ReadFeature[]
}) {
  return Object.assign(Object.create(CramRecord.prototype), fields) as CramRecord
}

test('read with no features is all matches', () => {
  expect(
    makeRecord({ flags: 0, readLength: 100, alignmentStart: 5 }).getCigarString(),
  ).toBe('100M')
})

test('substitutions stay within the match run', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      alignmentStart: 1,
      readFeatures: [{ code: 'X', data: 2, pos: 5, refPos: 5 }],
    }).getCigarString(),
  ).toBe('10M')
})

test('deletion and refskip', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 10,
      alignmentStart: 1,
      readFeatures: [
        { code: 'D', data: 3, pos: 5, refPos: 5 },
        { code: 'N', data: 100, pos: 5, refPos: 8 },
      ],
    }).getCigarString(),
  ).toBe('4M3D100N6M')
})

test('soft clip, insertion, hard clip', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 20,
      alignmentStart: 1,
      readFeatures: [
        { code: 'H', data: 5, pos: 1, refPos: 1 },
        { code: 'S', data: 'ACGT', pos: 1, refPos: 1 },
        { code: 'I', data: 'GG', pos: 5, refPos: 5 },
      ],
    }).getCigarString(),
  ).toBe('5H4S4M2I10M')
})

test('coalesces consecutive single-base insertions', () => {
  expect(
    makeRecord({
      flags: 0,
      readLength: 5,
      alignmentStart: 1,
      readFeatures: [
        { code: 'i', data: 'A', pos: 3, refPos: 3 },
        { code: 'i', data: 'C', pos: 4, refPos: 3 },
      ],
    }).getCigarString(),
  ).toBe('2M2I1M')
})

test('unmapped read returns *', () => {
  expect(
    makeRecord({ flags: 0x4, readLength: 100, alignmentStart: 1 }).getCigarString(),
  ).toBe('*')
})
