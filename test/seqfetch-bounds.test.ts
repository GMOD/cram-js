import { expect, test } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'
import { testDataFile } from './lib/util.ts'

// Regression guard for https://github.com/GMOD/cram-js/issues/79 (sparse CRAM
// over-fetch). When decoding against an external reference (via the seqFetch
// callback), cram-js must request only the span actually covered by the slice's
// reads, not the slice's declared refSeqSpan or the whole chromosome. A sparse
// slice whose reads happen to span a large region will still request that span
// (inherent to CRAM), but cram-js must never fetch beyond the reads' extent.
test('seqFetch is bounded to the reads covered extent (#79)', async () => {
  const fasta = new FetchableSmallFasta(
    testDataFile('human_g1k_v37.20.21.10M-10M200k.fa'),
  )
  const calls: { start: number; end: number }[] = []
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
    ),
    index: new CraiIndex({
      filehandle: testDataFile(
        'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
      ),
    }),
    seqFetch: async (id, start, end) => {
      calls.push({ start, end })
      return fasta.fetch(id, start, end)
    },
  })

  const records = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)
  expect(calls.length).toBeGreaterThan(0)

  // the reads covered extent, using lengthOnRef when present and falling back to
  // readLength (matches how the reference fetch computes its span)
  const readStart = Math.min(...records.map(r => r.alignmentStart))
  const readEnd = Math.max(
    ...records.map(r => r.alignmentStart + (r.lengthOnRef ?? r.readLength) - 1),
  )

  const fetchStart = Math.min(...calls.map(c => c.start))
  const fetchEnd = Math.max(...calls.map(c => c.end))
  expect(fetchStart).toBe(readStart)
  expect(fetchEnd).toBe(readEnd)
})
