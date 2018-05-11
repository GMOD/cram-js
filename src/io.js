const { promisify } = require('util')
const fetch = require('cross-fetch')

// don't load fs native module if running in webpacked code
const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase

const fsOpen = fs && promisify(fs.open)
const fsRead = fs && promisify(fs.read)
const fsFStat = fs && promisify(fs.fstat)

class RemoteFile {
  constructor(source) {
    this.position = 0
    this.url = source
  }

  async read(buffer, offset = 0, length, position) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }

    const response = await fetch(this.url, {
      method: 'GET',
      headers: { range: `bytes=${position}-${position + length}` },
      redirect: 'follow',
      mode: 'cors',
    })
    if (
      (response.status === 200 && position === 0) ||
      response.status === 206
    ) {
      const nodeBuffer = Buffer.from(await response.arrayBuffer())

      // try to parse out the size of the remote file
      const sizeMatch = /\/(\d+)$/.exec(response.headers.map['content-range'])
      if (sizeMatch[1]) this._size = parseInt(sizeMatch[1], 10)

      buffer.fill(nodeBuffer, offset)
    } else {
      throw new Error(`HTTP ${response.status} fetching ${this.url}`)
    }
  }

  async size() {
    if (!this._size) {
      const buf = Buffer.allocUnsafe(10)
      await this.read(buf, 0, 10, 0)
      if (!this._size)
        throw new Error(`unable to determine size of file at ${this.url}`)
    }
    return this._size
  }
}

class LocalFile {
  constructor(source) {
    this.position = 0
    this.filename = source
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

  async size() {
    if (!this.fileSize) {
      const { size } = await fsFStat(await this.fd)
      this.fileSize = size
    }
    return this.fileSize
  }
}

module.exports = { LocalFile, RemoteFile }
