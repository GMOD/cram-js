import { expect, test } from 'vitest'

import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { CramRecord, IndexedCramFile } from '../src/index.ts'

class Feature extends CramRecord {
  get name() {
    return this.readName
  }
  get end() {
    return this.start + (this.lengthOnRef ?? 0)
  }
}

test('recordClass hands out the consumer subclass from every query', async () => {
  const CRAM = 'SRR396636.sorted.clip.cram'
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile(CRAM),
    index: new CraiIndex({ filehandle: testDataFile(`${CRAM}.crai`) }),
    fetchReferenceSequence: async (_id, start, end) => 'A'.repeat(end - start),
    recordClass: Feature,
  })
  const records = await cram.getRecordsForRange(0, 0, 1000)
  expect(records.length).toBeGreaterThan(0)
  for (const r of records) {
    expect(r).toBeInstanceOf(Feature)
    expect(r.name).toBe(r.readName)
    expect(r.end).toBeGreaterThanOrEqual(r.start)
  }
  // a second query over the cached slice hands out the subclass too
  const again = await cram.getRecordsForRange(0, 500, 600)
  expect(again[0]).toBeInstanceOf(Feature)
})
