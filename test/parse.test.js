const { expect } = require('chai')
const { CramFile } = require('../src')

function testDataUrl(filename) {
  return typeof window === 'undefined'
    ? `file://${require.resolve(`./data/${filename}`).replace('#', '%23')}`
    : `http://localhost:9876/base/test/data/${filename.replace('#', '%23')}`
}

describe('CRAM reader', () => {
  it('can read a cram file definition', async () => {
    const file = new CramFile(testDataUrl('auxf#values.tmp.cram'))
    const header = await file.definition()
    expect(header).to.deep.equal({
      magic: 'CRAM',
      majorVersion: 3,
      minorVersion: 0,
      fileId: '-',
    })
  })

  it('can read the first container header of a cram file', async () => {
    const file = new CramFile(testDataUrl('auxf#values.tmp.cram'))
    const header = await file.containerHeader(0)
    expect(header).to.deep.equal({
      alignmentSpan: 0,
      crc32: 2996618296,
      landmarks: [0, 161],
      length: 250,
      numBases: 0,
      numBlocks: 2,
      numRecords: 0,
      recordCounter: 0,
      seqId: 0,
      start: 0,
    })
  })
})
