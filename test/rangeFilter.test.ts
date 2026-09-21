import { describe, expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type { CramRecord } from '../src/index.ts'

// getRecordsForRange tests the columns of a decoded slice before it builds a
// view. That has to select exactly what the per-record predicate it replaced
// selected, in the same order, so the old predicate is kept here as the oracle
// and run through the public predicate path, getRecordsInSlice.

function legacyOverlaps(
  r: CramRecord,
  seq: number,
  start: number,
  end: number,
) {
  if (r.sequenceId !== seq) {
    return false
  }
  if (r.lengthOnRef === undefined) {
    return r.start >= start && r.start < end
  }
  const span = r.lengthOnRef > 0 ? r.lengthOnRef : 1
  return r.start < end && r.start + span > start
}

function open(name: string) {
  const index = new CraiIndex({ filehandle: testDataFile(`${name}.crai`) })
  return {
    index,
    cram: new IndexedCramFile({
      cramFilehandle: testDataFile(name),
      index,
      useSliceWorkerPool: false,
    }),
  }
}

async function viaPredicate(
  cram: IndexedCramFile,
  index: CraiIndex,
  seq: number,
  start: number,
  end: number,
) {
  const out: CramRecord[] = []
  for (const entry of await index.getEntriesForRange(seq, start, end)) {
    out.push(
      ...(await cram.getRecordsInSlice(entry, r =>
        legacyOverlaps(r, seq, start, end),
      )),
    )
  }
  return out
}

/** windows whose edges sit on record edges, where an off-by-one would show */
function windowsAround(records: CramRecord[], limit: number) {
  const edges = new Set<number>()
  for (const r of records) {
    edges.add(r.start)
    edges.add(r.start + (r.lengthOnRef ?? 0))
  }
  const sorted = [...edges].sort((a, b) => a - b)
  const step = Math.max(1, Math.floor(sorted.length / limit))
  const windows: [number, number][] = []
  for (let i = 0; i < sorted.length; i += step) {
    const x = sorted[i]!
    windows.push([x, x + 1], [x - 1, x], [Math.max(0, x - 50), x + 50])
  }
  return windows
}

const fixtures = [
  // five mapped records with a zero read length and a zero-length feature,
  // so none of them consumes reference
  'xx#minimal.tmp.cram',
  // unmapped reads placed at their mate's position
  'ce#unmap2.tmp.cram',
  // multi-reference slices
  'xx#unsorted.tmp.cram',
  'ce#5b.tmp.cram',
  'SRR396636.sorted.clip.cram',
  'HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram',
]

describe('column range filter matches the record predicate', () => {
  test.each(fixtures)('%s', async name => {
    const { cram, index } = open(name)
    const seqIds = Object.keys(await index.getIndex())
      .map(Number)
      .filter(id => id >= 0)
    let compared = 0
    for (const seq of seqIds) {
      const all = await cram.getRecordsForRange(seq, 0, Number.MAX_SAFE_INTEGER)
      for (const [start, end] of [
        [0, Number.MAX_SAFE_INTEGER] as [number, number],
        ...windowsAround(all, 40),
      ]) {
        const mine = await cram.getRecordsForRange(seq, start, end)
        const theirs = await viaPredicate(cram, index, seq, start, end)
        expect(mine.map(r => r.uniqueId)).toStrictEqual(
          theirs.map(r => r.uniqueId),
        )
        compared += mine.length
      }
    }
    expect(compared).toBeGreaterThan(0)
  })

  // the fixtures above are only worth anything if they hold the cases the
  // column test branches on
  test('the fixtures cover every branch of the test', async () => {
    const records = (
      await Promise.all(
        fixtures.map(async name => {
          const { cram, index } = open(name)
          const ids = Object.keys(await index.getIndex()).map(Number)
          return (
            await Promise.all(
              ids.map(id =>
                cram.getRecordsForRange(id, 0, Number.MAX_SAFE_INTEGER),
              ),
            )
          ).flat()
        }),
      )
    ).flat()
    expect(records.some(r => r.lengthOnRef === 0)).toBe(true)
    expect(
      records.some(r => r.lengthOnRef === undefined && r.sequenceId >= 0),
    ).toBe(true)
    expect(
      records.some(r => {
        const ids = new Set(r.slice.records().map(other => other.sequenceId))
        return ids.size > 1
      }),
    ).toBe(true)
  })
})
