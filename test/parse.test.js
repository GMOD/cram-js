import { expect } from 'chai'

import { CramFile } from '../src'

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
})
