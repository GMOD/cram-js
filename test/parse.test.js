import {CramFile} from '../src'

describe('CRAM reader', () => {
  it('can read a cram file definition', async () => {
    const file = new CramFile(require.resolve('./data/auxf#values.tmp.cram'))
    const header = await file.definition()
    expect(header).toEqual({
      magic: 'CRAM',
      majorVersion: 3,
      minorVersion: 0,
      fileId: '-',
    })
  })
})
