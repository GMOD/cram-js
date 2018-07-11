const { promisify } = require('es6-promisify')
const zlib = require('zlib')

const gunzip = promisify(zlib.gunzip)

const { open } = require('./io')
const { CramMalformedError } = require('./errors')

class CraiIndex {
  // A CRAM index (.crai) is a gzipped tab delimited file containing the following columns:
  // 1. Sequence id
  // 2. Alignment start
  // 3. Alignment span
  // 4. Container start byte position in the file
  // 5. Slice start byte position in the container data (‘blocks’)
  // 6. Slice size in bytes
  // Each line represents a slice in the CRAM file. Please note that all slices must be listed in index file.

  /**
   *
   * @param {object} args
   * @param {string} [args.path]
   * @param {string} [args.url]
   * @param {FileHandle} [args.filehandle]
   */
  constructor(args) {
    const filehandle = open(args.url, args.path, args.filehandle)
    this.readFile = filehandle.readFile.bind(filehandle)
    this.index = this.parseIndex()
  }

  parseIndex() {
    const index = {}
    return this.readFile()
      .then(data => {
        if (data[0] === 31 && data[1] === 139) return gunzip(data)
        return data
      })
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
              if (
                [
                  seqId,
                  start,
                  span,
                  containerStart,
                  sliceStart,
                  sliceBytes,
                ].some(el => el === undefined)
              )
                throw new CramMalformedError('invalid .crai index file')
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
        Object.entries(index).forEach(([seqId, entries]) => {
          index[seqId] = entries.sort(
            (a, b) => a.start - b.start || a.span - b.span,
          )
        })
        return index
      })
  }

  getIndex() {
    return this.index
  }

  /**
   * @param {number} seqId
   * @returns {Promise[boolean]} true if the index contains entries for
   * the given reference sequence ID, false otherwise
   */
  async hasDataForReferenceSequence(seqId) {
    return !!(await this.index)[seqId]
  }

  /**
   * fetch index entries for the given range
   *
   * @param {number} seqId
   * @param {number} queryStart
   * @param {number} queryEnd
   */
  async getEntriesForRange(seqId, queryStart, queryEnd) {
    const seqEntries = (await this.index)[seqId]
    if (!seqEntries) return []
    const len = seqEntries.length

    // binary search to find an entry that
    // overlaps the range, then extend backward
    // and forward from that
    const compare = entry => {
      const entryStart = entry.start
      const entryEnd = entry.start + entry.span
      if (entryStart >= queryEnd) return -1 // entry is ahead of query
      if (entryEnd <= queryStart) return 1 // entry is behind query
      return 0 // entry overlaps query
    }

    let lowerBound = 0
    let upperBound = len - 1
    let searchPosition = Math.floor(len / 2)

    let lastSearchPosition = -1
    let nextSearchDirection
    for (;;) {
      nextSearchDirection = compare(seqEntries[searchPosition])
      if (nextSearchDirection > 0) {
        lowerBound = searchPosition
      } else if (nextSearchDirection < 0) {
        upperBound = searchPosition
      } else {
        break
      }

      lastSearchPosition = searchPosition
      searchPosition = Math.floor((upperBound + lowerBound) / 2)
      if (lastSearchPosition === searchPosition) return []
    }

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

module.exports = CraiIndex
