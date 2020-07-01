const { expect } = require('chai')

const mock = require('mock-fs')
const LocalFile = require('./lib/syncLocalFile')

const { IndexedCramFile } = require('../src/index')
const CraiIndex = require('../src/craiIndex')

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
    } catch (e) {
      /* console.error('initial error', e) */
      exception = 1
    }
    expect(exception).to.equal(1)

    mock.restore()
    const ret = await cram.cram.getSamHeader()

    expect(ret[0].tag).to.equal('HD')
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
    } catch (e) {
      exception = 1
    }
    expect(exception).to.equal(1)

    mock.restore()
    const features = await cram.getRecordsForRange(0, 2, 200)
    expect(features.length).to.equal(8)
  })
})
