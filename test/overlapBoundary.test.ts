import { expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

// A read overlaps a half-open query [start, end) as soon as its last aligned
// base reaches `start`. The filter used to require the last base to sit strictly
// past the query start, which silently dropped every read overlapping by exactly
// one base — see the counts pinned below, which came out three short.
//
// Ground truth is samtools 1.23.1 / htslib 1.23.1. Its regions are 1-based and
// inclusive on both ends, so the 0-based half-open [a, b) used here is
// `a+1`-`b` there.

function openCram(name: string) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(name),
    index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
  })
}

// samtools view -c SRR396636.sorted.clip.cram NC_002516.2:25999-26499 -> 410
test('record count matches samtools at a window edge', async () => {
  const feats = await openCram('SRR396636.sorted.clip.cram').getRecordsForRange(
    0,
    25998,
    26499,
  )
  expect(feats.length).toBe(410)
})

// samtools view -c ce#tag_padded.tmp.cram CHROMOSOME_I:2-200 -> 8, whose
// POS/CIGAR pairs give exactly these 0-based (start, lengthOnRef) spans.
test('padded records match samtools spans', async () => {
  const feats = await openCram('ce#tag_padded.tmp.cram').getRecordsForRange(
    0,
    1,
    200,
  )
  expect(
    feats.map(f => `${f.start}+${f.lengthOnRef}`).sort(),
  ).toStrictEqual(
    ['1+101', '1+101', '1+101', '1+101', '1+101', '1+1', '101+1', '27+3'].sort(),
  )
})

// The boundary itself, stated without reference to any particular file: a query
// beginning on a read's last base must return it, and a query beginning one base
// later must not.
test('a read is returned exactly while the query still covers its last base', async () => {
  const cram = openCram('SRR396637.sorted.clip.cram')
  const all = await cram.getRecordsForRange(0, 0, 1_000_000)
  const read = all.find(f => (f.lengthOnRef ?? 0) > 1)!
  expect(read).toBeDefined()

  const lastBase = read.start + read.lengthOnRef! - 1
  // readName is optional on CramRecord: a lossy-names file leaves it undefined
  const has = (feats: { readName: string | undefined; start: number }[]) =>
    feats.some(f => f.readName === read.readName && f.start === read.start)

  expect(has(await cram.getRecordsForRange(0, lastBase, lastBase + 1000))).toBe(
    true,
  )
  expect(
    has(await cram.getRecordsForRange(0, lastBase + 1, lastBase + 1000)),
  ).toBe(false)
})
