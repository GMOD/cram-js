// @ts-nocheck
import fs from 'fs'

const fsOpen = fs.openSync
const fsRead = fs.readSync
const fsReadFile = fs.readFileSync
const fsFStat = fs.statSync

class LocalFile {
  constructor(source) {
    this.position = 0
    this.filename = source
  }

  async read(buffer, offset, length, position) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }
    return fsRead(fsOpen(this.filename, 'r'), buffer, offset, length, position)
  }

  async readFile() {
    return fsReadFile(this.filename)
  }

  async stat() {
    return fsFStat(this.filename)
  }
}

module.exports = LocalFile
