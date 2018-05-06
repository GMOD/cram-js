const url = require('url')
const { LocalFile, RemoteFile } = require('./io')
const sectionParsers = require('./sectionParsers')

class CramFile {
  constructor(source) {
    const { protocol, pathname } = url.parse(source)
    if (protocol === 'file:') {
      this.file = new LocalFile(unescape(pathname))
    } else {
      this.file = new RemoteFile(source)
    }
  }

  async _readSection(offset, parser, maxLength) {
    const bytes = Buffer.allocUnsafe(maxLength)
    await this.file.read(bytes, 0, maxLength, offset)
    return parser.parse(bytes)
  }

  async definition() {
    const { cramFileDefinition } = sectionParsers
    const headbytes = Buffer.allocUnsafe(cramFileDefinition.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinition.maxLength, 0)
    return cramFileDefinition.parser.parse(headbytes).result
  }

  async containerHeader(containerNumber) {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers

    // skip with a series of reads to the proper container
    await Promise.all(
      new Array(containerNumber).map(async () => {
        const bytes = Buffer.allocUnsafe(4)
        await this.file.read(bytes, 0, 4, offset)
        const containerSize = bytes.readUInt32LE()
        offset += containerSize
      }),
    )

    // parse the container
    const { offset: header1Size, result: header1 } = await this._readSection(
      offset,
      cramContainerHeader1.parser,
      cramContainerHeader1.maxLength,
    )

    offset += header1Size

    const { result: header2 } = await this._readSection(
      offset,
      cramContainerHeader2.parser,
      cramContainerHeader2.maxLength(header1.numBlocks),
    )

    return Object.assign(header1, header2)
  }
}

class IndexedCramFile {
  //  constructor({ cram, crai, fasta, fai }) {}
}

module.exports = { CramFile, IndexedCramFile }
