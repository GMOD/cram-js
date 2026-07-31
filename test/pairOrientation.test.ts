import { expect, test } from 'vitest'

import CramRecord from '../src/cramFile/record.ts'

import type { MateRecord } from '../src/cramFile/record.ts'

const PAIRED = 0x1
const REVERSE = 0x10
const MATE_REVERSE = 0x20
const READ1 = 0x40
const READ2 = 0x80

type RecordArgs = ConstructorParameters<typeof CramRecord>[0]

function makeRecord({
  flags,
  sequenceId,
  alignmentStart,
  mate,
  templateLength,
}: {
  flags: number
  sequenceId: number
  alignmentStart: number
  mate?: MateRecord
  templateLength?: number
}) {
  const args: RecordArgs = {
    flags,
    cramFlags: 0,
    readLength: 100,
    mappingQuality: 60,
    lengthOnRef: 100,
    qualityScores: undefined,
    readGroupId: 0,
    sequenceId,
    uniqueId: 1,
    alignmentStart,
    tags: {},
    mate,
    readNameRaw: undefined,
    templateSize: undefined,
    mateRecordNumber: undefined,
    readFeatureArena: undefined,
    readFeatureStart: 0,
    readFeatureCount: 0,
    readBases: undefined,
  }
  const record = new CramRecord(args)
  record.templateLength = templateLength
  return record
}

// Both mates of one pair must produce the same string, or the two halves render
// as different orientations. template length must not influence the answer: it
// is left at 0 whenever the insert size is unavailable.
// SYNC: ~/src/gmod/bam-js test/bai.test.ts pair orientation tests
const LOCI = [
  { seqId: 1, mateSeqId: 1, pos: 100, matePos: 300 }, // self left, same ref
  { seqId: 1, mateSeqId: 1, pos: 300, matePos: 100 }, // self right, same ref
  { seqId: 1, mateSeqId: 1, pos: 100, matePos: 100 }, // same locus -> tie-break
  { seqId: 1, mateSeqId: 5, pos: 100, matePos: 300 }, // cross-ref, self lower
  { seqId: 5, mateSeqId: 1, pos: 100, matePos: 300 }, // cross-ref, self higher
]

test('both mates of a pair agree on the orientation', () => {
  for (const selfRev of [0, REVERSE]) {
    for (const mateRev of [0, MATE_REVERSE]) {
      for (const loci of LOCI) {
        for (const [tlen1, tlen2] of [
          [100, -100], // spec-correct
          [0, 0], // insert size unavailable
          [100, 100], // both positive
        ]) {
          const read1 = makeRecord({
            flags: PAIRED | READ1 | selfRev | mateRev,
            sequenceId: loci.seqId,
            alignmentStart: loci.pos,
            mate: { sequenceId: loci.mateSeqId, alignmentStart: loci.matePos },
            templateLength: tlen1,
          })
          // the mate sees the strands the other way round
          const read2 = makeRecord({
            flags:
              PAIRED |
              READ2 |
              (mateRev ? REVERSE : 0) |
              (selfRev ? MATE_REVERSE : 0),
            sequenceId: loci.mateSeqId,
            alignmentStart: loci.matePos,
            mate: { sequenceId: loci.seqId, alignmentStart: loci.pos },
            templateLength: tlen2,
          })
          expect(read1.getPairOrientation()).toBe(read2.getPairOrientation())
        }
      }
    }
  }
})

test('orientation of a canonical FR pair', () => {
  const mate = { sequenceId: 1, alignmentStart: 300 }
  expect(
    makeRecord({
      flags: PAIRED | READ1 | MATE_REVERSE,
      sequenceId: 1,
      alignmentStart: 100,
      mate,
      templateLength: 300,
    }).getPairOrientation(),
  ).toBe('F1R2')
  expect(
    makeRecord({
      flags: PAIRED | READ1 | REVERSE,
      sequenceId: 1,
      alignmentStart: 100,
      mate,
      templateLength: 300,
    }).getPairOrientation(),
  ).toBe('R1F2')
})

test('orientation is undefined only for unpaired reads', () => {
  const mate = { sequenceId: 1, alignmentStart: 300 }
  expect(
    makeRecord({
      flags: READ1 | MATE_REVERSE,
      sequenceId: 1,
      alignmentStart: 100,
      mate,
    }).getPairOrientation(),
  ).toBeUndefined()

  // An unmapped read or mate still points a direction, and both mates still
  // agree on the orientation, so it is reported rather than dropped.
  expect(
    makeRecord({
      flags: PAIRED | READ1 | MATE_REVERSE | 0x4,
      sequenceId: 1,
      alignmentStart: 100,
      mate,
    }).getPairOrientation(),
  ).toBe('F1R2')

  // Cross-reference pairs are oriented too, ordered by sequence id.
  expect(
    makeRecord({
      flags: PAIRED | READ1 | MATE_REVERSE,
      sequenceId: 1,
      alignmentStart: 100,
      mate: { sequenceId: 9, alignmentStart: 300 },
      templateLength: 0,
    }).getPairOrientation(),
  ).toBe('F1R2')
})

test('an unknown mate falls back to read1-first, keeping mates consistent', () => {
  const read1 = makeRecord({
    flags: PAIRED | READ1 | MATE_REVERSE,
    sequenceId: 1,
    alignmentStart: 100,
  })
  const read2 = makeRecord({
    flags: PAIRED | READ2 | REVERSE,
    sequenceId: 1,
    alignmentStart: 300,
  })
  expect(read1.getPairOrientation()).toBe('F1R2')
  expect(read2.getPairOrientation()).toBe('F1R2')
})
