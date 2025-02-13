import { expect, test } from 'vitest'

import { testDataFile } from './lib/util'
import CraiIndex from '../src/craiIndex'
import { IndexedCramFile } from '../src/index'

test('archive', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('igv-js-bug/archived.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('igv-js-bug/archived.cram.crai'),
    }),
  })
  const samHeader = await cram.cram.getSamHeader()

  const nameToId = {}
  const sqLines = samHeader.filter(l => l.tag === 'SQ')
  sqLines.forEach((sqLine, refId) => {
    sqLine.data.forEach(item => {
      if (item.tag === 'SN') {
        // this is the ref name
        const refName = item.value
        nameToId[refName] = refId
      }
    })
  })
  // @ts-expect-error
  const feats = await cram.getRecordsForRange(nameToId.chr9, 0, 200000000)
  expect(feats[0]!.qualityScores).toMatchSnapshot()
  expect(feats.length).toBe(10000)
})

test('normal', async () => {
  const cram = new IndexedCramFile({
    cramFilehandle: testDataFile('igv-js-bug/normal.cram'),
    index: new CraiIndex({
      filehandle: testDataFile('igv-js-bug/normal.cram.crai'),
    }),
  })
  const samHeader = await cram.cram.getSamHeader()

  const nameToId = {}
  const sqLines = samHeader.filter(l => l.tag === 'SQ')
  sqLines.forEach((sqLine, refId) => {
    sqLine.data.forEach(item => {
      if (item.tag === 'SN') {
        // this is the ref name
        const refName = item.value
        nameToId[refName] = refId
      }
    })
  })
  // @ts-expect-error
  const feats = await cram.getRecordsForRange(nameToId.chr9, 0, 200000000)
  expect(feats[0]!.qualityScores).toMatchSnapshot()
  expect(feats.length).toBe(10000)
})
