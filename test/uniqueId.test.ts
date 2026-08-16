import fs from 'fs'

import { expect, test } from 'vitest'

import { CramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

import type CramSlice from '../src/cramFile/slice/index.ts'

// A record's uniqueId is `sliceHeader.contentPosition + recordCounter + 1 + i`
// (ADR 0011). Issue #161 is that the CRAM spec defines the record counter as a
// sequential index but gives a reader no way to check it, so htslib's own
// `record_counter + rec + 1` would collide outright on a file that left the
// counter constant. The slice's file offset is what covers that; the sweeps
// below pin both the ids the decoder actually hands out and the two header
// properties the no-collision argument rests on.

function openCram(filename: string) {
  // no reference: ids come off the slice header, and every file in the corpus
  // decodes without one — only the substitutions in the bases would need it
  return new CramFile({
    filehandle: testDataFile(filename),
    checkSequenceMD5: false,
  })
}

async function eachSlice(
  filename: string,
  visit: (slice: CramSlice) => Promise<void>,
) {
  const cram = openCram(filename)
  const containerCount = await cram.containerCount()
  // container 0 is the SAM header, which holds no slices
  for (let i = 1; i < containerCount; i++) {
    const container = await cram.getContainerById(i)
    const header = await container?.getHeader()
    if (!header) {
      continue
    }
    const { numLandmarks, landmarks, length } = header
    for (let j = 0; j < numLandmarks; j++) {
      const start = landmarks[j]!
      const end = j + 1 < numLandmarks ? landmarks[j + 1]! : length
      await visit(container!.getSlice(start, end - start))
    }
  }
}

interface SliceIdRange {
  contentPosition: number
  recordCounter: number
  numRecords: number
  base: number
}

async function sliceIdRanges(filename: string) {
  const ranges: SliceIdRange[] = []
  await eachSlice(filename, async slice => {
    const header = await slice.getHeader()
    const { recordCounter, numRecords } = header.parsedContent
    ranges.push({
      contentPosition: header.contentPosition,
      recordCounter,
      numRecords,
      base: header.contentPosition + recordCounter + 1,
    })
  })
  return ranges
}

const cramFiles = fs.readdirSync('test/data').filter(f => f.endsWith('.cram'))

test('there is a corpus to sweep', () => {
  // the sweeps below pass vacuously if the readdir stops matching, and a test
  // that cannot fail is worse than no test
  expect(cramFiles.length).toBeGreaterThan(100)
})

// Decoded, not derived: this is the one that would notice the formula changing
// under it. The whole corpus decodes in under a second, so there is no reason
// to sample it.
test.each(cramFiles)('%s hands out no uniqueId twice', async filename => {
  const seen = new Set<number>()
  let records = 0
  await eachSlice(filename, async slice => {
    for (const record of await slice.getRecords(() => true)) {
      records++
      seen.add(record.uniqueId)
      // the ids live in a Float64Array, so they have to stay exactly
      // representable as well as distinct
      expect(Number.isSafeInteger(record.uniqueId)).toBe(true)
    }
  })
  expect(seen.size).toBe(records)
})

test.each(cramFiles)('%s keeps its slice ranges disjoint', async filename => {
  const ranges = await sliceIdRanges(filename)

  let previous: SliceIdRange | undefined
  for (const slice of ranges) {
    if (previous) {
      expect(slice.contentPosition).toBeGreaterThan(previous.contentPosition)
      expect(slice.recordCounter).toBeGreaterThanOrEqual(previous.recordCounter)
      // the two together: this slice starts above everything the last one
      // claimed, so no record in the file can share an id with another
      expect(slice.base).toBeGreaterThanOrEqual(
        previous.base + previous.numRecords,
      )
    }
    previous = slice
  }
})

// What the file offset buys, measured: were a writer to leave the record
// counter constant, ids would collide only where a slice occupies fewer bytes
// than it holds records. No slice in the corpus comes near that.
test('a slice always spans more bytes than it holds records', async () => {
  let worst = Infinity
  let worstFile = ''
  for (const filename of cramFiles) {
    const ranges = await sliceIdRanges(filename)
    for (let i = 0; i + 1 < ranges.length; i++) {
      const bytes = ranges[i + 1]!.contentPosition - ranges[i]!.contentPosition
      const bytesPerRecord = bytes / ranges[i]!.numRecords
      if (bytesPerRecord < worst) {
        worst = bytesPerRecord
        worstFile = filename
      }
    }
  }
  expect(worstFile).toBeTruthy()
  expect(worst).toBeGreaterThan(4)
})
