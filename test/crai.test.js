const { expect } = require('chai')

const { testDataFile } = require('./lib/util')

const CraiIndex = require('../src/craiIndex')

describe('.crai reader', () => {
  it('can read xx#unsorted.tmp.cram.crai', async () => {
    const filehandle = testDataFile('xx#unsorted.tmp.cram.crai')
    const index = new CraiIndex({ filehandle })
    let data = await index.getIndex()
    expect(data).to.deep.equal({
      '0': [
        {
          start: 1,
          span: 20,
          containerStart: 562,
          sliceStart: 143,
          sliceBytes: 200,
        },
        {
          start: 1,
          span: 20,
          containerStart: 923,
          sliceStart: 173,
          sliceBytes: 243,
        },
      ],
      '1': [
        {
          start: 1,
          span: 10,
          containerStart: 923,
          sliceStart: 173,
          sliceBytes: 243,
        },
        {
          start: 11,
          span: 10,
          containerStart: 252,
          sliceStart: 181,
          sliceBytes: 111,
        },
      ],
    })

    expect(await index.getEntriesForRange(2, 0, 0)).to.deep.equal([])
    expect(await index.getEntriesForRange(-1, 9, 9)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, 100, 300)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, -100, -80)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, 0, 20)).to.deep.equal(data[0])
    expect(await index.getEntriesForRange(0, 1, 21)).to.deep.equal(data[0])
    expect(await index.getEntriesForRange(1, 0, 20)).to.deep.equal(data[1])

    data = {
      '0': [
        { start: 1, span: 1 },
        { start: 100, span: 1 },
        { start: 101, span: 1 },
        { start: 102, span: 1 },
        { start: 300, span: 1 },
        { start: 400, span: 10 },
        { start: 404, span: 1 },
        { start: 410, span: 1 },
      ],
    }
    index.index = Promise.resolve(data)
    expect(await index.getEntriesForRange(0, 1, 2)).to.deep.equal([data[0][0]])
    expect(await index.getEntriesForRange(0, 1, 100)).to.deep.equal([
      data[0][0],
    ])
    expect(await index.getEntriesForRange(0, 100, 101)).to.deep.equal([
      data[0][1],
    ])
  })

  it('throws an error if you try to read cramQueryWithCRAI.cram as a .crai', () => {
    const filehandle = testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram',
    )
    const index = new CraiIndex({ filehandle })
    const dataP = index.getIndex()
    return dataP.then(
      () => {
        throw new Error('the getIndex call should have failed')
      },
      err => {
        expect(err).to.match(/invalid/)
      },
    )
  })

  it('can read cramQueryWithCRAI.cram.crai', async () => {
    const filehandle = testDataFile(
      'human_g1k_v37.20.21.10M-10M200k#cramQueryWithCRAI.cram.crai',
    )
    const index = new CraiIndex({ filehandle })
    const data = await index.getIndex()
    // console.log(JSON.stringify(data, null, ' '))
    expect(data).to.deep.equal({
      '0': [
        {
          start: 100009,
          span: 102,
          containerStart: 1953,
          sliceStart: 592,
          sliceBytes: 1024,
        },
      ],
      '-1': [
        {
          start: 0,
          span: 1,
          containerStart: 3590,
          sliceStart: 209,
          sliceBytes: 271,
        },
      ],
    })
  })
})
