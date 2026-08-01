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
