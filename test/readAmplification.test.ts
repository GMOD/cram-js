import { LocalFile } from 'generic-filehandle2'
import { describe, expect, it, vi } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import { IndexedCramFile } from '../src/index.ts'

// Counts what a query actually pulls off disk, because over HTTP every one of
// these is a range request. The numbers here are the ones the README quotes.
class CountingFile extends LocalFile {
  reads: { position: number; length: number }[] = []

  override async read(length: number, position = 0) {
    const data = await super.read(length, position)
    this.reads.push({ position, length: data.length })
    return data
  }

  get medianReadLength() {
    const lengths = this.reads.map(r => r.length).sort((a, b) => a - b)
    return lengths[lengths.length >> 1]
  }
}

const CRAM = 'test/data/ce#1000.tmp.cram'

describe('what a query reads', () => {
  it('reads a 141 KB file as one range per slice plus a few per container', async () => {
    const cramFilehandle = new CountingFile(CRAM)
    const craiFilehandle = new CountingFile(`${CRAM}.crai`)
    const readIndex = vi.spyOn(craiFilehandle, 'readFile')
    const cram = new IndexedCramFile({
      cramFilehandle,
      index: new CraiIndex({ filehandle: craiFilehandle }),
    })

    const records = await cram.getRecordsForRange(0, 0, 100000000)
    expect(records).toHaveLength(1000)

    const { size } = await cramFilehandle.stat()
    expect(size).toBeLessThan(150000)
    // 149 slices, one read each, and three per container — the two halves of
    // its header and the compression header block. This used to be 546 reads
    // with a median under 80 bytes, back when every block was probed for its
    // header and then read again.
    expect(cramFilehandle.reads).toHaveLength(231)
    expect(cramFilehandle.medianReadLength).toBeGreaterThan(80)

    // the index is one fetch, so it is not part of that scatter
    expect(readIndex).toHaveBeenCalledTimes(1)
    expect(craiFilehandle.reads).toEqual([])
  })
})
