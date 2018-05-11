const { promisify } = require('es6-promisify')
const zlib = require('zlib')

const gunzip = promisify(zlib.gunzip)

class CramIndex {
  // A CRAM index is a gzipped tab delimited file containing the following columns:
  // 1. Sequence id
  // 2. Alignment start
  // 3. Alignment span
  // 4. Container start byte offset in the file
  // 5. Slice start byte offset in the container data (‘blocks’) 6. Slice bytes
  // Each line represents a slice in the CRAM file. Please note that all slices must be listed in index file.
  constructor(readFile) {
    // read the whole thing, then un-gzip it
    this.readFile = readFile
    this.lines = this.parseIndex()
  }

  parseIndex() {
    return this.readFile()
      .then(data => gunzip(data))
      .then(uncompressedBuffer =>
        uncompressedBuffer
          .toString('utf8')
          .split(/\r?\n/)
          .map(line => line.split('\t').map(s => parseInt(s, 10)))
          .filter(
            line => line && line[0] !== undefined && !Number.isNaN(line[0]),
          )
          .map(
            ([seqId, start, span, containerStart, sliceStart, sliceBytes]) => ({
              seqId,
              start,
              span,
              containerStart,
              sliceStart,
              sliceBytes,
            }),
          ),
      )
  }

  getLines() {
    return this.lines
  }
}

module.exports = CramIndex
