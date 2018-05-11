const { expect } = require('chai')

const { testDataFile } = require('./util')

const CramIndex = require('../src/cramIndex')

describe('.crai reader', () => {
  it('can read auxf#values.tmp.cram.crai', async () => {
    const file = testDataFile('auxf#values.tmp.cram.crai')
    const index = new CramIndex(file.readFile.bind(file))
    const lines = await index.getLines()
    expect(lines).to.deep.equal([
      {
        seqId: 0,
        start: 1,
        span: 20,
        containerStart: 295,
        sliceStart: 1042,
        sliceBytes: 1989,
      },
    ])
  })
})
