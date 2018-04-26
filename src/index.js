import fs from 'fs'
import { promisify } from 'es6-promisify'

const fsOpen = promisify(fs.open)
const fsRead = promisify(fs.read)

const BinaryParser = require('binary-parser').Parser

function parser() {
  return new BinaryParser().endianess('little')
}

class File {
  constructor(source) {
    this.filename = source
    this.position = 0
    this.fd = fsOpen(this.filename, 'r')
  }

  async read(buffer, offset = 0, length, position) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }
    return fsRead(await this.fd, buffer, offset, length, position)
  }
}

const structParsers = {
  cramFileDefinition: parser()
    .string('magic', { length: 4 })
    .uint8('majorVersion')
    .uint8('minorVersion')
    .string('fileId', { length: 20, stripNull: true }),
}
export class CramFile {
  constructor(source) {
    this.file = new File(source)
  }
  async definition() {
    const headbytes = Buffer.alloc(26)
    await this.file.read(headbytes, 0, 26, 0)
    return structParsers.cramFileDefinition.parse(headbytes)
  }
}

export class IndexedCramFile {
  //  constructor({ cram, crai, fasta, fai }) {}
}
