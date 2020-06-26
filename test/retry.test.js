const { expect } = require('chai')

const mock = require('mock-fs')
const { testDataFile, fs } = require('./lib/util')
const LocalFile = require('./lib/syncLocalFile')

const { IndexedCramFile } = require('../src/index')
const CraiIndex = require('../src/craiIndex')

describe('retry nonexist file', () => {
  it('file moves', async () => {
    let cram
    mock({})
    console.log(LocalFile)
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
    }

    mock.restore()
    const ret = await cram.cram.getSamHeader()

    expect(ret[0].tag).to.equal('HD')
  })
})
