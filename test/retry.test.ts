// @ts-nocheck
import { describe, it, expect } from 'vitest'
import mock from 'mock-fs'
import LocalFile from './lib/syncLocalFile'

import { IndexedCramFile } from '../src/index'
import CraiIndex from '../src/craiIndex'

describe('retry nonexist file', () => {
  it('file moves', async () => {
    let cram
    mock({})
    let exception = 0
    try {
      cram = new IndexedCramFile({
        cramFilehandle: new LocalFile('./test/data/ce#tag_padded.tmp.cram'),
        index: new CraiIndex({
          filehandle: new LocalFile('./test/data/ce#tag_padded.tmp.cram.crai'),
        }),
      })

      await cram.cram.getSamHeader()
    } catch (_e) {
      exception = 1
    }
    expect(exception).toEqual(1)

    mock.restore()
    const ret = await cram.cram.getSamHeader()

    expect(ret[0].tag).toEqual('HD')
  })
  it('index moves', async () => {
    let cram
    mock({})
    let exception = 0
    try {
      cram = new IndexedCramFile({
        cramFilehandle: new LocalFile('./test/data/ce#tag_padded.tmp.cram'),
        index: new CraiIndex({
          filehandle: new LocalFile('./test/data/ce#tag_padded.tmp.cram.crai'),
        }),
      })

      await cram.getRecordsForRange(0, 2, 200)
    } catch (_e) {
      exception = 1
    }
    expect(exception).toEqual(1)

    mock.restore()
    const features = await cram.getRecordsForRange(0, 2, 200)
    expect(features.length).toEqual(8)
  })
})
