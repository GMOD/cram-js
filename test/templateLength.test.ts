import { expect, test } from 'vitest'
import { IndexedCramFile } from '../src/index'
import CraiIndex from '../src/craiIndex'
import { testDataFile } from './lib/util'

// seqFetch stub — both xx and yy refs are this same 20bp sequence
const seqFetch = async () => 'AAAAAAAAAATTTTTTTTTT'

function openTlen(file: string) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(file),
    index: new CraiIndex({ filehandle: testDataFile(`${file}.crai`) }),
    seqFetch,
  })
}

// Expected TLEN per read, keyed by `${readName}@${pos}`.
// Values derived directly from the .sam_ source files alongside the CRAMs.
// xx reads: SAM spec leftmost-positive encoding
// yy reads: bwa/picard 5'->3' encoding (stored as templateSize, not estimated)
const expectedTlen: Record<string, number> = {
  'x1@1': 20,
  'x1@16': -20,
  'x2@7': 8,
  'x2@10': -8,
  'x3@7': 8,
  'x3@10': -8,
  'x4@1': 20,
  'x4@16': -20,
  'y1@1': 20,
  'y1@16': -20,
  'y2@7': 8,
  'y2@10': -8,
  'y3@7': -2,
  'y3@10': 2,
  'y4@1': 10,
  'y4@16': -10,
}

async function collectTlens(cram: IndexedCramFile) {
  const result: Record<string, number> = {}
  const xx = await cram.getRecordsForRange(0, 1, 20)
  const yy = await cram.getRecordsForRange(1, 1, 20)
  for (const r of [...xx, ...yy]) {
    const tlen = r.templateLength ?? r.templateSize
    if (tlen !== undefined) {
      result[`${r.readName}@${r.alignmentStart}`] = tlen
    }
  }
  return result
}

test('templateLength sign matches SAM spec (sorted pairs)', async () => {
  const cram = openTlen('xx#tlen.tmp.cram')
  expect(await collectTlens(cram)).toEqual(expectedTlen)
})

test('templateLength sign matches SAM spec (unsorted/interleaved pairs)', async () => {
  const cram = openTlen('xx#tlen2.tmp.cram')
  expect(await collectTlens(cram)).toEqual(expectedTlen)
})
