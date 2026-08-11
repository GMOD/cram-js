// The slice-transfer protocol has to reproduce a decoded slice exactly, or a
// worker-decoded query silently differs from an in-process one. So this asserts
// on the *whole* public surface of every record of every indexed fixture, rather
// than on a hand-picked field list that would miss whatever gets added next.
import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import {
  deserializeSliceRecords,
  serializeSliceRecords,
} from '../src/cramFile/sliceTransfer.ts'
import { IndexedCramFile } from '../src/index.ts'

import type CramRecord from '../src/cramFile/record.ts'

const seqFetch = async (_id: number, start: number, end: number) =>
  'A'.repeat(end - start)

function open(path: string) {
  return new IndexedCramFile({
    cramFilehandle: new LocalFile(path),
    index: new CraiIndex({ filehandle: new LocalFile(`${path}.crai`) }),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
}

/**
 * Everything a consumer can observe about a record, as comparable values.
 *
 * `toJSON` alone is not enough: it omits the columnar accessors, and those are
 * exactly what the transfer rewires. So the tag and read-feature views are read
 * back through the record's own accessors, which is what proves the rebuilt
 * column is indexed the way the record expects.
 */
function observe(r: CramRecord) {
  return {
    json: r.toJSON(),
    tags: r.tags,
    // through getTag as well as `tags`, since it reads the column directly and
    // would not notice a broken name->id map that materialize() papers over
    tagsViaGetTag: Object.fromEntries(
      Object.keys(r.tags).map(k => [k, r.getTag(k)]),
    ),
    readFeatures: r.readFeatures,
    cigar: r.getCigarString(),
    pairOrientation: r.getPairOrientation(),
    hasNextPosition: r.hasNextPosition(),
    nextSequenceId: r.nextSequenceId,
    nextStart: r.nextStart,
    qualityScores: r.qualityScores ? [...r.qualityScores] : r.qualityScores,
    readBases: r.readBases,
    mateRecordNumber: r.mateRecordNumber,
    templateLength: r.templateLength,
    templateSize: r.templateSize,
    mappingQuality: r.mappingQuality,
    lengthOnRef: r.lengthOnRef,
    uniqueId: r.uniqueId,
    readName: r.readName,
  }
}

// Only the indexed fixtures — the transfer is reached through a range query.
const cases = [
  // paired short reads with MC/XA/SA string tags and mate association
  'test/data/SRR396637.sorted.clip.cram',
  'test/data/SRR396636.sorted.clip.cram',
  // long reads: 213k read features in one slice, and a huge quality column
  'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
  // deliberate aux-tag type coverage, including the B-array and H lanes that no
  // performance fixture exercises
  'test/data/auxf#values.tmp.cram',
  'test/data/xx#large_aux.tmp.cram',
  'test/data/xx#large_aux2.tmp.cram',
  // a '*' record whose readBases is null rather than absent — the one case
  // needing two presence bits rather than one
  'test/data/c1#noseq.tmp.cram',
  // unmapped reads, mate association across pairs and triplets, template lengths
  'test/data/ce#unmap.tmp.cram',
  'test/data/ce#unmap2.tmp.cram',
  'test/data/xx#unsorted.tmp.cram',
  'test/data/xx#triplet.tmp.cram',
  'test/data/xx#pair.tmp.cram',
  'test/data/xx#tlen.tmp.cram',
  'test/data/paired.cram',
  'test/data/long_pair.cram',
  // read groups, so the RG path and readGroupId are exercised
  'test/data/xx#rg.tmp.cram',
  // a blank slice, i.e. the empty-column edge
  'test/data/xx#blank.tmp.cram',
  // real-world files. Deliberately excluded: grc37-1#HG03297… is a truncated
  // fixture that throws on read, and volvox-sorted.cram is an orphan .crai with
  // no .cram beside it.
  'test/data/volvox-long-reads-sv.cram',
  'test/data/hard_clipping.cram',
  'test/data/cram31.cram',
  'test/data/na12889_lossy.cram',
  'test/data/paired-region.cram',
  'test/data/ce#1000.tmp.cram',
  'test/data/ce#large_seq.tmp.cram',
  'test/data/human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
]

for (const path of cases) {
  test(`slice transfer round-trips ${path}`, async () => {
    const before = await open(path).getRecordsForRange(0, 0, 100_000_000)
    // a second, independent decode: serialize *detaches* the buffers it
    // transfers, so the "before" records must not be the ones serialized
    const source = await open(path).getRecordsForRange(0, 0, 100_000_000)
    expect(source.length).toBe(before.length)

    // Serialise per slice, which is the function's contract and what
    // `_fetchRecords` does. A range query returns every slice covering it, each
    // with its own columns; `tagColumn` identity is the slice boundary, since
    // every record has one whether or not it carries tags.
    const bySlice = new Map<unknown, typeof source>()
    for (const r of source) {
      let group = bySlice.get(r.tagColumn)
      if (!group) {
        group = []
        bySlice.set(r.tagColumn, group)
      }
      group.push(r)
    }
    const after: typeof source = []
    const transfer: ArrayBuffer[] = []
    for (const group of bySlice.values()) {
      const out = serializeSliceRecords(group)
      after.push(...deserializeSliceRecords(out.payload))
      transfer.push(...out.transfer)
    }
    expect(after.length).toBe(before.length)

    // Re-attach the reference region, which the protocol deliberately does not
    // carry: `fetchReferenceSequence` is a caller-supplied callback and cannot
    // cross into a worker, so the real integration calls applyReferenceSequence
    // on the main thread after deserialising. Without this, `getReadBases()`
    // has nothing to reconstruct a mapped read's bases from and returns
    // undefined — which is the protocol behaving as designed, not a fault.
    //
    // The *substitutions* those bases resolve against do travel, in the arena's
    // refCodes/subCodes columns, so this restores exactly the one thing that
    // does not.
    for (const [i, r] of after.entries()) {
      r._refRegion = before[i]!._refRegion
    }

    // observed after decoration on both sides, so the comparison covers the
    // reference-derived surface (bases, CIGAR, mismatch ref/sub) too
    expect(after.map(observe)).toEqual(before.map(observe))
    // every buffer listed for transfer must be distinct, or postMessage throws
    expect(new Set(transfer).size).toBe(transfer.length)
  })
}

test('unplaced reads and an empty range survive the round trip', async () => {
  const path = 'test/data/xx#unsorted.tmp.cram'
  const source = await open(path).getRecordsForRange(-1, -1, 100_000_000)
  const before = await open(path).getRecordsForRange(-1, -1, 100_000_000)
  const { payload } = serializeSliceRecords(source)
  const after = deserializeSliceRecords(payload)
  for (const [i, r] of after.entries()) {
    r._refRegion = before[i]!._refRegion
  }
  expect(after.map(observe)).toEqual(before.map(observe))
})

test('serializing across slice boundaries is refused rather than silently wrong', async () => {
  // ce#1000 spans many slices, so its query result mixes several column sets —
  // exactly the array that used to serialise to plausible-looking garbage
  const records = await open('test/data/ce#1000.tmp.cram').getRecordsForRange(
    0,
    0,
    100_000_000,
  )
  const columns = new Set(records.map(r => r.tagColumn))
  expect(columns.size).toBeGreaterThan(1)
  expect(() => serializeSliceRecords(records)).toThrow(
    /more than one slice.*serialise each slice separately/s,
  )
})
