const { expect } = require('chai')

const { testDataFile } = require('./util')

const CramIndex = require('../src/cramIndex')

describe('.crai reader', () => {
  it('can read xx#unsorted.tmp.cram.crai', async () => {
    const file = testDataFile('xx#unsorted.tmp.cram.crai')
    const index = new CramIndex(file.readFile.bind(file))
    let data = await index.getIndex()
    expect(data).to.deep.equal([
      [
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
      [
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
    ])

    expect(await index.getEntriesForRange(2, 0, 0)).to.deep.equal([])
    expect(await index.getEntriesForRange(-1, 9, 9)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, 100, 300)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, -100, -80)).to.deep.equal([])
    expect(await index.getEntriesForRange(0, 0, 20)).to.deep.equal(data[0])
    expect(await index.getEntriesForRange(0, 1, 21)).to.deep.equal(data[0])
    expect(await index.getEntriesForRange(1, 0, 20)).to.deep.equal(data[1])

    data = [
      [
        { start: 1, span: 1 },
        { start: 100, span: 1 },
        { start: 101, span: 1 },
        { start: 102, span: 1 },
        { start: 300, span: 1 },
        { start: 400, span: 10 },
        { start: 404, span: 1 },
        { start: 410, span: 1 },
      ],
    ]
    index.index = Promise.resolve(data)
    expect(await index.getEntriesForRange(0, 1, 2)).to.deep.equal([data[0][0]])
    expect(await index.getEntriesForRange(0, 1, 100)).to.deep.equal([
      data[0][0],
    ])
    expect(await index.getEntriesForRange(0, 100, 101)).to.deep.equal([
      data[0][1],
    ])
  })
})
