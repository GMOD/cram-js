// The worker decodes from bytes alone, by a path that deliberately does not
// share code with `_fetchRecords`. That freedom is only safe if the two produce
// the same records, so this drives the bytes-only path in-process — no worker
// involved — and compares it against the ordinary decode of the same slices.
import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import CramFile from '../src/cramFile/index.ts'
import {
  clearSchemeCache,
  decodeSliceFromBytes,
  schemeCacheSize,
} from '../src/cramFile/slice/decodeSliceFromBytes.ts'
import { deserializeSliceRecords } from '../src/cramFile/sliceTransfer.ts'
import { IndexedCramFile } from '../src/index.ts'

import type CramRecord from '../src/cramFile/record.ts'

const seqFetch = async (_id: number, start: number, end: number) =>
  'A'.repeat(end - start)

function openIndexed(path: string) {
  return new IndexedCramFile({
    cramFilehandle: new LocalFile(path),
    index: new CraiIndex({ filehandle: new LocalFile(`${path}.crai`) }),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
}

/**
 * The observable surface, minus anything the reference decorates.
 *
 * The bytes-only path stops before the reference on purpose — see
 * `sliceTransfer.ts` — so `readBases` and the mismatch `ref`/`sub` are compared
 * in the round-trip test instead, which re-attaches a region the way the main
 * thread does. What is left here is everything the decode itself decides, which
 * is what this test is about.
 */
function observe(r: CramRecord) {
  return {
    flags: r.flags,
    cramFlags: r.cramFlags,
    start: r.start,
    readLength: r.readLength,
    lengthOnRef: r.lengthOnRef,
    sequenceId: r.sequenceId,
    readGroupId: r.readGroupId,
    mappingQuality: r.mappingQuality,
    readName: r.readName,
    uniqueId: r.uniqueId,
    templateLength: r.templateLength,
    templateSize: r.templateSize,
    nextSequenceId: r.nextSequenceId,
    nextStart: r.nextStart,
    hasNextPosition: r.hasNextPosition(),
    mateRecordNumber: r.mateRecordNumber,
    tags: r.tags,
    readFeatureCount: r.readFeatureCount,
    // the arena columns for this record's own slots, which is what a bulk
    // consumer reads and what the transfer rewires
    features: r.readFeatureArena
      ? [...Array(r.readFeatureCount).keys()].map(k => {
          const i = r.readFeatureStart + k
          const a = r.readFeatureArena!
          return [a.codes[i], a.pos[i], a.refPos[i], a.num[i]]
        })
      : undefined,
    qualityScores: r.qualityScores ? [...r.qualityScores] : r.qualityScores,
    pairOrientation: r.getPairOrientation(),
  }
}

interface SliceEntry {
  containerStart: number
  sliceStart: number
  sliceBytes: number
}

/**
 * The slices of `path`, from whichever reference sequence has any.
 *
 * Several fixtures put their reads somewhere other than refseq 0 — an
 * unmapped-only file uses -1 — and asserting on 0 would quietly test nothing on
 * those rather than failing, so the id is discovered.
 */
async function findSlices(path: string): Promise<SliceEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const index = (openIndexed(path) as any).index
  for (const seqId of [-1, ...Array(25).keys()]) {
    const entries = (await index.getEntriesForRange(
      seqId,
      -1,
      100_000_000,
    )) as SliceEntry[]
    if (entries.length > 0) {
      return entries
    }
  }
  return []
}

const cases = [
  'test/data/SRR396637.sorted.clip.cram',
  'test/data/SRR396636.sorted.clip.cram',
  'test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
  'test/data/auxf#values.tmp.cram',
  'test/data/xx#large_aux.tmp.cram',
  'test/data/c1#noseq.tmp.cram',
  'test/data/ce#unmap.tmp.cram',
  'test/data/xx#triplet.tmp.cram',
  'test/data/xx#pair.tmp.cram',
  'test/data/xx#tlen.tmp.cram',
  'test/data/xx#rg.tmp.cram',
  'test/data/ce#1000.tmp.cram',
  'test/data/paired.cram',
  'test/data/long_pair.cram',
  'test/data/cram31.cram',
  'test/data/na12889_lossy.cram',
  'test/data/volvox-long-reads-sv.cram',
  'test/data/hard_clipping.cram',
]

for (const path of cases) {
  test(`bytes-only decode matches the in-process decode for ${path}`, async () => {
    clearSchemeCache()
    const slices = await findSlices(path)
    expect(slices.length).toBeGreaterThan(0)

    const file = new CramFile({
      filehandle: new LocalFile(path),
      fetchReferenceSequence: seqFetch,
      checkSequenceMD5: false,
    })

    let comparedRecords = 0
    for (const entry of slices) {
      const container = file.getContainerAtPosition(entry.containerStart)
      const slice = container.getSlice(entry.sliceStart, entry.sliceBytes)

      const req = await slice.buildDecodeRequest({ decodeTags: true })
      expect(req).toBeDefined()

      const { payload } = await decodeSliceFromBytes(req!)
      const fromBytes = deserializeSliceRecords(payload)

      // the ordinary path, on a separate CramFile so nothing is shared
      const plainFile = new CramFile({
        filehandle: new LocalFile(path),
        fetchReferenceSequence: seqFetch,
        checkSequenceMD5: false,
      })
      const plainSlice = plainFile
        .getContainerAtPosition(entry.containerStart)
        .getSlice(entry.sliceStart, entry.sliceBytes)
      const inProcess = await plainSlice.getRecords(() => true, {
        decodeTags: true,
      })

      expect(fromBytes.length).toBe(inProcess.length)
      expect(fromBytes.map(observe)).toEqual(inProcess.map(observe))
      comparedRecords += fromBytes.length
    }
    expect(comparedRecords).toBeGreaterThan(0)
  })
}

// One pool serves every CRAM in the context, and the scheme cache is keyed on a
// container's file position — which two files share whenever their SAM headers
// are the same length, as two samples from one pipeline usually are. These two
// fixtures both have a container at 418, and before 13.3.1 the second file
// decoded with the first one's codecs and was reported malformed.
test('the scheme cache does not confuse two files whose containers coincide', async () => {
  clearSchemeCache()
  const paths = [
    'test/data/SRR396637.sorted.clip.cram',
    'test/data/SRR396636.sorted.clip.cram',
  ]
  const entries = await Promise.all(
    paths.map(async p => {
      const slice = (await findSlices(p)).find(s => s.containerStart === 418)
      expect(slice).toBeDefined()
      return { path: p, slice: slice! }
    }),
  )

  for (const { path, slice: entry } of entries) {
    const file = new CramFile({
      filehandle: new LocalFile(path),
      fetchReferenceSequence: seqFetch,
      checkSequenceMD5: false,
    })
    const slice = file
      .getContainerAtPosition(entry.containerStart)
      .getSlice(entry.sliceStart, entry.sliceBytes)
    const req = await slice.buildDecodeRequest({ decodeTags: true })
    const { payload } = await decodeSliceFromBytes(req!)
    const fromBytes = deserializeSliceRecords(payload)
    const inProcess = await slice.getRecords(() => true, { decodeTags: true })

    expect(fromBytes.length).toBe(inProcess.length)
    expect(fromBytes.map(observe)).toEqual(inProcess.map(observe))
  }
})

test('the scheme cache serves several slices of one container', async () => {
  clearSchemeCache()
  const path = 'test/data/ce#1000.tmp.cram'
  const slices = await findSlices(path)
  const file = new CramFile({
    filehandle: new LocalFile(path),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
  // several slices sharing one container is the case the cache exists for
  const byContainer = new Set(slices.map(s => s.containerStart))
  expect(slices.length).toBeGreaterThan(byContainer.size)

  let total = 0
  for (const entry of slices) {
    const slice = file
      .getContainerAtPosition(entry.containerStart)
      .getSlice(entry.sliceStart, entry.sliceBytes)
    const req = await slice.buildDecodeRequest({ decodeTags: true })
    const { payload } = await decodeSliceFromBytes(req!)
    total += deserializeSliceRecords(payload).length
  }
  expect(total).toBeGreaterThan(0)
})

// The cache used to be unbounded, on the reasoning that a worker sees "tens,
// not thousands" of containers. A worker lives as long as the page, and the
// queries the pool is worth the most to are the ones that walk a whole contig,
// so this pins that a long walk cannot grow it without limit — and that records
// decoded after eviction are still correct, since a re-parsed scheme has to be
// as good as the one it replaced.
test('the scheme cache is bounded by a walk over many containers', async () => {
  clearSchemeCache()
  const path = 'test/data/ce#1000.tmp.cram'
  const slices = await findSlices(path)
  const file = new CramFile({
    filehandle: new LocalFile(path),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })

  const containers = [...new Set(slices.map(s => s.containerStart))]
  expect(containers.length).toBeGreaterThan(16)

  const first = slices[0]!
  const decode = async (entry: (typeof slices)[number]) => {
    const req = await file
      .getContainerAtPosition(entry.containerStart)
      .getSlice(entry.sliceStart, entry.sliceBytes)
      .buildDecodeRequest({ decodeTags: true })
    const { payload } = await decodeSliceFromBytes(req!)
    return deserializeSliceRecords(payload)
  }

  const before = (await decode(first)).map(observe)

  for (const entry of slices) {
    await decode(entry)
  }
  expect(schemeCacheSize()).toBeLessThanOrEqual(16)

  // the first container is long evicted by now; decoding it again re-parses
  const after = (await decode(first)).map(observe)
  expect(after).toEqual(before)
})
