import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

// seqFetch stub — both xx and yy refs are this same 20bp sequence
const seqFetch = async () => 'AAAAAAAAAATTTTTTTTTT'

function openTlen(file: string) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(file),
    index: new CraiIndex({ filehandle: testDataFile(`${file}.crai`) }),
    fetchReferenceSequence: seqFetch,
  })
}

// Expected TLEN per read, keyed by `${readName}@${pos}`.
// Values derived directly from the .sam_ source files alongside the CRAMs.
// xx reads: SAM spec leftmost-positive encoding
// yy reads: bwa/picard 5'->3' encoding (stored as templateSize, not estimated)
const expectedTlen: Record<string, number> = {
  'x1@0': 20,
  'x1@15': -20,
  'x2@6': 8,
  'x2@9': -8,
  'x3@6': 8,
  'x3@9': -8,
  'x4@0': 20,
  'x4@15': -20,
  'y1@0': 20,
  'y1@15': -20,
  'y2@6': 8,
  'y2@9': -8,
  'y3@6': -2,
  'y3@9': 2,
  'y4@0': 10,
  'y4@15': -10,
}

async function collectTlens(cram: IndexedCramFile) {
  const result: Record<string, number> = {}
  const xx = await cram.getRecordsForRange(0, 1, 20)
  const yy = await cram.getRecordsForRange(1, 1, 20)
  for (const r of [...xx, ...yy]) {
    const tlen = r.templateLength ?? r.templateSize
    if (tlen !== undefined) {
      result[`${r.readName}@${r.start}`] = tlen
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
