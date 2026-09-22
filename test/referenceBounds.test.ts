import { describe, expect, test } from 'vitest'

import { CraiIndex, CramArgumentError, IndexedCramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'
import { alignments, samtoolsAvailable } from './lib/samtools.ts'
import { testDataFile } from './lib/util.ts'

import type { SeqFetch } from '../src/index.ts'

// Three 100M reads on a 1000 bp reference, at 900, 950 and 960 (1-based), so
// the last two overhang its end. CRAM reads the reference past the end as N,
// which is why htslib encodes o2's overhang as substitutions from N and o3's
// run of N as plain matches — and o3 is the one that needs the N to be there.
const NAME = 'overhang#end.tmp.cram'
const fasta = new FetchableSmallFasta(testDataFile('overhang.fa'))

function open(fetchReferenceSequence: SeqFetch) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(NAME),
    index: new CraiIndex({ filehandle: testDataFile(`${NAME}.crai`) }),
    useSliceWorkerPool: false,
    fetchReferenceSequence,
  })
}

async function bases(fetchReferenceSequence: SeqFetch) {
  const records = await open(fetchReferenceSequence).getRecordsForRange(
    0,
    0,
    1000,
  )
  return Object.fromEntries(records.map(r => [r.readName, r.getReadBases()]))
}

describe.skipIf(!samtoolsAvailable())('reads overhanging a contig', () => {
  const expected = () =>
    Object.fromEntries(
      alignments(`test/data/${NAME}`, 'ohchr', [
        '-T',
        'test/data/overhang.fa',
      ]).map(line => {
        const f = line.split('\t')
        return [f[0], f[6]]
      }),
    )

  test('decode as samtools does, asking once and only for bases that exist', async () => {
    const requests: [number, number][] = []
    const result = await bases(async (id, start, end) => {
      requests.push([start, end])
      return fasta.fetch(id, start, end)
    })
    expect(result).toEqual(expected())
    expect(requests).toEqual([[899, 1000]])
  })
})

test('a callback answering with more bases than asked for is an error', async () => {
  // the pre-v10 1-based closed contract, which would shift every base by one
  await expect(
    bases(async (id, start, end) => fasta.fetch(id, start - 1, end)),
  ).rejects.toThrow(CramArgumentError)
})

test('a reference shorter than the header says reads as N past its end', async () => {
  const ref = await fasta.fetch(0, 0, 1000)
  const result = await bases(async (id, start, end) =>
    fasta.fetch(id, start, Math.min(end, 980)),
  )
  expect(result.o1).toBe(ref.slice(899, 980) + 'N'.repeat(19))
})
