const { promisify } = require('es6-promisify')
const zlib = require('zlib')

const gunzip = promisify(zlib.gunzip)

class CramIndex {
  // A CRAM index (.crai) is a gzipped tab delimited file containing the following columns:
  // 1. Sequence id
  // 2. Alignment start
  // 3. Alignment span
  // 4. Container start byte offset in the file
  // 5. Slice start byte offset in the container data (‘blocks’) 6. Slice bytes
  // Each line represents a slice in the CRAM file. Please note that all slices must be listed in index file.
  constructor(filehandle) {
    this.readFile = filehandle.readFile.bind(filehandle)
    this.index = this.parseIndex()
  }

  parseIndex() {
    const index = []
    return this.readFile()
      .then(data => gunzip(data))
      .then(uncompressedBuffer => {
        uncompressedBuffer
          .toString('utf8')
          .split(/\r?\n/)
          .map(line => line.split('\t').map(s => parseInt(s, 10)))
          .filter(
            line => line && line[0] !== undefined && !Number.isNaN(line[0]),
          )
          .forEach(
            ([seqId, start, span, containerStart, sliceStart, sliceBytes]) => {
              if (!index[seqId]) index[seqId] = []

              index[seqId].push({
                start,
                span,
                containerStart,
                sliceStart,
                sliceBytes,
              })
            },
          )

        // sort each of them by start
        index.forEach((entries, i) => {
          index[i] = entries.sort(
            (a, b) => a.start - b.start || a.span - b.span,
          )
        })
        return index
      })
  }

  getIndex() {
    return this.index
  }

  async getEntriesForRange(seqId, queryStart, queryEnd) {
    const seqEntries = (await this.index)[seqId]
    if (!seqEntries) return []
    const len = seqEntries.length

    // binary search to find an entry that
    // overlaps the range, then extend backward
    // and forward from that
    let searchPosition = Math.floor(len / 2)
    const compare = entry => {
      const entryStart = entry.start
      const entryEnd = entry.start + entry.span
      if (entryStart >= queryEnd) return -1 // entry is ahead of query
      if (entryEnd <= queryStart) return 1 // entry is behind query
      return 0 // entry overlaps query
    }
    let nextSearchDirection
    do {
      nextSearchDirection = compare(seqEntries[searchPosition])
      if (nextSearchDirection > 0) {
        if (searchPosition === len - 1)
          // we are at the right end and have found no overlapping ranges
          return []
        searchPosition = Math.floor((searchPosition + len) / 2)
      } else if (nextSearchDirection < 0) {
        if (searchPosition === 0)
          // we are all the way at the left end and have found no overlapping ranges
          return []
        searchPosition = Math.floor(searchPosition / 2)
      }
    } while (nextSearchDirection)

    // now extend backward
    let overlapStart = searchPosition
    while (overlapStart && !compare(seqEntries[overlapStart - 1]))
      overlapStart -= 1
    // and then extend forward
    let overlapEnd = searchPosition
    while (overlapEnd < len - 1 && !compare(seqEntries[overlapEnd + 1]))
      overlapEnd += 1

    return seqEntries.slice(overlapStart, overlapEnd + 1)
  }
}

module.exports = CramIndex
