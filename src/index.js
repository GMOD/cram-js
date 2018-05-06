const url = require('url')
const crc32 = require('buffer-crc32')

const { LocalFile, RemoteFile } = require('./io')
const sectionParsers = require('./sectionParsers')

const { itf8Size } = require('./cramTypes')

class CramFile {
  constructor(source) {
    const { protocol, pathname } = url.parse(source)
    if (protocol === 'file:') {
      this.file = new LocalFile(unescape(pathname))
    } else {
      this.file = new RemoteFile(source)
    }

    this.validateChecksums = true
  }

  // async _readSection(offset, parser, maxLength) {
  //   const bytes = Buffer.allocUnsafe(maxLength)
  //   await this.file.read(bytes, 0, maxLength, offset)
  //   return parser.parse(bytes)
  // }

  async definition() {
    const { cramFileDefinition } = sectionParsers
    const headbytes = Buffer.allocUnsafe(cramFileDefinition.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinition.maxLength, 0)
    return cramFileDefinition.parser.parse(headbytes).result
  }

  async containerHeader(containerNumber) {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const fileSize = await this.file.size()
    const { cramContainerHeader1 } = sectionParsers

    // skip with a series of reads to the proper container
    let currentHeader
    for (
      let i = 0;
      i <= containerNumber &&
      offset + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      currentHeader = await this.readContainerHeader(offset)
      offset += currentHeader.headerBytes + currentHeader.length
    }

    return currentHeader
  }

  async readContainerHeader(offset) {
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers
    const fileSize = await this.file.size()

    if (offset >= fileSize) return undefined

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = Buffer.allocUnsafe(cramContainerHeader1.maxLength)
    await this.file.read(bytes1, 0, cramContainerHeader1.maxLength, offset)
    const {
      offset: header1Size,
      result: header1,
    } = cramContainerHeader1.parser.parse(bytes1)
    const numLandmarksSize = itf8Size(header1.numLandmarks)

    const bytes2 = Buffer.allocUnsafe(
      cramContainerHeader2.maxLength(header1.numLandmarks),
    )
    await this.file.read(
      bytes2,
      0,
      cramContainerHeader2.maxLength(header1.numLandmarks),
      offset + header1Size - numLandmarksSize,
    )
    const {
      result: header2,
      offset: header2Size,
    } = cramContainerHeader2.parser.parse(bytes2)

    const completeHeader = Object.assign(header1, header2)
    completeHeader.headerBytes = header1Size + header2Size - numLandmarksSize

    if (this.validateChecksums) {
      await this.checkCrc32(
        offset,
        header1Size + header2Size - numLandmarksSize - 4,
        completeHeader.crc32,
        `container header beginning at offset ${offset}`,
      )
    }

    return completeHeader
  }

  async checkCrc32(offset, length, recordedCrc32, description) {
    const b = Buffer.allocUnsafe(length)
    await this.file.read(b, 0, length, offset)
    const calculatedCrc32 = crc32.unsigned(b)
    if (calculatedCrc32 !== recordedCrc32) {
      throw new Error(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  async containerCount() {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const fileSize = await this.file.size()
    const { cramContainerHeader1 } = sectionParsers

    let i
    for (
      i = 0;
      offset + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      const currentHeader = await this.readContainerHeader(offset)
      offset += currentHeader.headerBytes + currentHeader.length
    }

    return i + 1
  }
}

class IndexedCramFile {
  //  constructor({ cram, crai, fasta, fai }) {}
}

module.exports = { CramFile, IndexedCramFile }
