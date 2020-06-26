// don't load fs native module if running in webpacked code
const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase

const fsOpen = fs.openSync
const fsRead = fs.readSync
const fsReadFile = fs.readFileSync
const fsFStat = fs.statSync

class LocalFile {
  constructor(source) {
    this.position = 0
    this.filename = source
  }

  async read(buffer, offset = 0, length, position) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }
    return fsRead(fsOpen(this.filename), buffer, offset, length, position)
  }

  async readFile() {
    return fsReadFile(this.filename)
  }

  async stat() {
    return fsFStat(this.filename)
  }
}

module.exports = LocalFile
