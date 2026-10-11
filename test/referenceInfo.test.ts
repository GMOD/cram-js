import { expect, test } from 'vitest'

import { testDataFile } from './lib/util.ts'
import CraiIndex from '../src/craiIndex.ts'
import { CramFile, IndexedCramFile } from '../src/index.ts'

test('reads the @SQ table', async () => {
  const cram = new CramFile({
    filehandle: testDataFile('ce#5.tmp.cram'),
  })

  expect(await cram.getReferenceInfo()).toEqual([
    {
      name: 'CHROMOSOME_I',
      length: 1009800,
      md5: '8ede36131e0dbf3417807e48f77f3ebd',
    },
    {
      name: 'CHROMOSOME_II',
      length: 5000,
      md5: '8e7993f7a93158587ee897d7287948ec',
    },
    {
      name: 'CHROMOSOME_III',
      length: 5000,
      md5: '3adcb065e1cf74fafdbba1e8c352b323',
    },
    {
      name: 'CHROMOSOME_IV',
      length: 5000,
      md5: '251af66a69ee589c9f3757340ec2de6f',
    },
    {
      name: 'CHROMOSOME_V',
      length: 5000,
      md5: 'cf200a65fb754836dcc56b24b3170ee8',
    },
  ])
  expect(await cram.getReferenceId('CHROMOSOME_III')).toBe(2)
  expect(await cram.getReferenceName(2)).toBe('CHROMOSOME_III')
})

// -1 is a valid seqId meaning "unplaced", so an unknown name must not quietly
// resolve to findIndex's -1 and fetch the unplaced reads instead
test('an unknown name throws rather than returning -1', async () => {
  const cram = new CramFile({
    filehandle: testDataFile('ce#5.tmp.cram'),
  })
  await expect(cram.getReferenceId('nonexistent')).rejects.toThrow(
    /no @SQ line/,
  )
})

test('an id with no @SQ line has no name', async () => {
  const cram = new CramFile({
    filehandle: testDataFile('ce#5.tmp.cram'),
  })
  expect(await cram.getReferenceName(99)).toBeUndefined()
  expect(await cram.getReferenceName(-1)).toBeUndefined()
})

test('a CRAM with no @SQ lines has an empty table', async () => {
  const cram = new CramFile({
    filehandle: testDataFile('xx#blank.tmp.cram'),
  })
  expect(await cram.getReferenceInfo()).toEqual([])
  expect(await cram.getReferenceName(0)).toBeUndefined()
})

function openIndexed(name: string) {
  return new IndexedCramFile({
    cramFilehandle: testDataFile(name),
    index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
  })
}

const readNames = (records: { readName?: string }[]) =>
  records.map(r => r.readName).sort()

test('getRecordsForRange takes a reference name', async () => {
  const cram = openIndexed('ce#5b.tmp.cram')
  const byName = await cram.getRecordsForRange('CHROMOSOME_V', 0, 5000)
  expect(byName.length).toBe(3)
  expect(new Set(byName.map(r => r.sequenceId))).toEqual(new Set([4]))
  expect(readNames(byName)).toEqual(
    readNames(await cram.getRecordsForRange(4, 0, 5000)),
  )
})

test('a name not in the header has no records', async () => {
  expect(
    await openIndexed('ce#5b.tmp.cram').getRecordsForRange('chr1', 0, 5000),
  ).toEqual([])
})

test('viewAsPairs finds mates when queried by name', async () => {
  const cram = openIndexed('paired.cram')
  const name = await cram.cram.getReferenceName(19)
  const opts = { viewAsPairs: true }
  const plain = await cram.getRecordsForRange(name!, 62500, 64500)
  const pairs = await cram.getRecordsForRange(name!, 62500, 64500, opts)
  expect(pairs.length).toBeGreaterThan(plain.length)
  expect(readNames(pairs)).toEqual(
    readNames(await cram.getRecordsForRange(19, 62500, 64500, opts)),
  )
})

test('hasDataForReferenceSequence takes a reference name', async () => {
  const cram = openIndexed('ce#5.tmp.cram')
  expect(await cram.hasDataForReferenceSequence('CHROMOSOME_I')).toBe(true)
  expect(await cram.hasDataForReferenceSequence('CHROMOSOME_II')).toBe(false)
  expect(await cram.hasDataForReferenceSequence('chr1')).toBe(false)
})

test('fetchReferenceSequence receives the refName', async () => {
  const seen: (string | undefined)[] = []
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('ce#5.tmp.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('ce#5.tmp.cram.crai'),
    }),
    fetchReferenceSequence: async (_seqId, start, end, refName) => {
      seen.push(refName)
      return 'A'.repeat(end - start)
    },
    checkSequenceMD5: false,
  })

  await cram.getRecordsForRange(0, 10000, 20000)
  expect(seen.length).toBeGreaterThan(0)
  expect([...new Set(seen)]).toEqual(['CHROMOSOME_I'])
})
