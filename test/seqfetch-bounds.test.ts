import { expect, test } from 'vitest'

import { dumpWholeFile } from './lib/dumpFile.ts'
import { testDataFile } from './lib/util.ts'
import { CramFile } from '../src/index.ts'
import CramRecord from '../src/cramFile/record.ts'

// Pull every decoded CramRecord out of a dumpWholeFile() result. Slice dumps
// expose their records on a `features` array; other entries don't.
function collectRecords(dump: unknown[]) {
  const records: CramRecord[] = []
  for (const container of dump) {
    const data =
      container && typeof container === 'object' && 'data' in container
        ? (container as { data?: unknown }).data
        : undefined
    if (Array.isArray(data)) {
      for (const entry of data) {
        const features =
          entry && typeof entry === 'object' && 'features' in entry
            ? (entry as { features?: unknown }).features
            : undefined
        if (Array.isArray(features)) {
          for (const f of features) {
            if (f instanceof CramRecord) {
              records.push(f)
            }
          }
        }
      }
    }
  }
  return records
}

// Regression guard for https://github.com/GMOD/cram-js/issues/79 (sparse CRAM
// over-fetch). 0600_mapped.cram carries an embedded reference (refBaseBlockId >=
// 0), yet when a seqFetch callback is supplied cram-js resolves the reference
// through the callback rather than the embedded block, and requests only the
// span actually covered by the slice's reads — not the slice's declared
// refSeqSpan or the whole chromosome.
test('seqFetch is used over embedded reference and bounded to read extent', async () => {
  const calls: { id: number; start: number; end: number }[] = []
  const file = new CramFile({
    filehandle: testDataFile('hts-specs/cram/3.0/passed/0600_mapped.cram'),
    seqFetch: async (id, start, end) => {
      calls.push({ id, start, end })
      return 'N'.repeat(end - start + 1)
    },
  })

  const records = collectRecords(await dumpWholeFile(file))
  const mapped = records.filter(r => r.lengthOnRef !== undefined)

  // embedded reference present, but seqFetch was still consulted
  expect(calls.length).toBeGreaterThan(0)

  // the fetched span matches the reads' covered extent exactly, proving cram-js
  // does not over-fetch beyond the aligned reads
  const minStart = Math.min(...mapped.map(r => r.alignmentStart))
  const maxEnd = Math.max(...mapped.map(r => r.alignmentStart + r.lengthOnRef!))
  const fetchStart = Math.min(...calls.map(c => c.start))
  const fetchEnd = Math.max(...calls.map(c => c.end))
  expect(fetchStart).toBe(minStart)
  expect(fetchEnd).toBe(maxEnd - 1)
})
