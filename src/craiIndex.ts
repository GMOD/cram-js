import AbortablePromiseCache from 'abortable-promise-cache'
import QuickLRU from 'quick-lru'
import { unzip } from './unzip'
import { open } from './io'
import { CramMalformedError } from './errors'
import { CramFileSource } from './cramFile/file'
import { Filehandle } from './cramFile/filehandle'

const BAI_MAGIC = 21578050 // BAI\1

export interface Slice {
  start: number
  span: number
  containerStart: number
  sliceStart: number
  sliceBytes: number
}

type ParsedIndex = Record<string, Slice[]>

function addRecordToIndex(index: ParsedIndex, record: number[]) {
  const [seqId, start, span, containerStart, sliceStart, sliceBytes] = record

  if (!index[seqId]) {
    index[seqId] = []
  }

  index[seqId].push({
    start,
    span,
    containerStart,
    sliceStart,
    sliceBytes,
  })
}

export default class CraiIndex {
  // A CRAM index (.crai) is a gzipped tab delimited file containing the following columns:
  // 1. Sequence id
  // 2. Alignment start
  // 3. Alignment span
  // 4. Container start byte position in the file
  // 5. Slice start byte position in the container data (‘blocks’)
  // 6. Slice size in bytes
  // Each line represents a slice in the CRAM file. Please note that all slices must be listed in index file.
  private _parseCache: AbortablePromiseCache<unknown, ParsedIndex>
  private filehandle: Filehandle

  /**
   *
   * @param {object} args
   * @param {string} [args.path]
   * @param {string} [args.url]
   * @param {FileHandle} [args.filehandle]
   */
  constructor(args: CramFileSource) {
    this.filehandle = open(args.url, args.path, args.filehandle)
    this._parseCache = new AbortablePromiseCache<unknown, ParsedIndex>({
      cache: new QuickLRU({ maxSize: 1 }),
      fill: (data, signal) => this.parseIndex(),
    })
  }

  parseIndex() {
    const index: ParsedIndex = {}
    return this.filehandle
      .readFile()
      .then(data => {
        if (data[0] === 31 && data[1] === 139) {
          return unzip(data)
        }
        return data
      })
      .then(buf => {
        if (buf.length > 4 && buf.readUInt32LE(0) === BAI_MAGIC) {
          throw new CramMalformedError(
            'invalid .crai index file. note: file appears to be a .bai index. this is technically legal but please open a github issue if you need support',
          )
        }
        // interpret the text as regular ascii, since it is supposed to be only
        // digits and whitespace characters this is written in a deliberately
        // low-level fashion for performance, because some .crai files can be
        // pretty large.
        let rec: number[] = []
        let str = ''
        for (const c of buf) {
          if (
            (c >= 48 && c <= 57) /* 0-9 */ ||
            (!str && c === 45) /* leading - */
          ) {
            str += String.fromCharCode(c)
          } else if (c === 9 /* \t */) {
            rec.push(Number.parseInt(str, 10))
            str = ''
          } else if (c === 10 /* \n */) {
            rec.push(Number.parseInt(str, 10))
            str = ''
            addRecordToIndex(index, rec)
            rec = []
          } else if (c !== 13 /* \r */ && c !== 32 /* space */) {
            // if there are other characters in the file besides
            // space and \r, something is wrong.
            throw new CramMalformedError('invalid .crai index file')
          }
        }

        // if the file ends without a \n, we need to flush our buffers
        if (str) {
          rec.push(Number.parseInt(str, 10))
        }
        if (rec.length === 6) {
          addRecordToIndex(index, rec)
        }

        // sort each of them by start
        Object.entries(index).forEach(([seqId, ent]) => {
          index[seqId] = ent.sort(
            (a, b) => a.start - b.start || a.span - b.span,
          )
        })
        return index
      })
  }

  getIndex(opts: { signal?: AbortSignal } = {}) {
    return this._parseCache.get('index', null, opts.signal)
  }

  /**
   * @param {number} seqId
   * @returns {Promise} true if the index contains entries for
   * the given reference sequence ID, false otherwise
   */
  async hasDataForReferenceSequence(seqId: number) {
    return !!(await this.getIndex())[seqId]
  }

  /**
   * fetch index entries for the given range
   *
   * @param {number} seqId
   * @param {number} queryStart
   * @param {number} queryEnd
   *
   * @returns {Promise} promise for
   * an array of objects of the form
   * `{start, span, containerStart, sliceStart, sliceBytes }`
   */
  async getEntriesForRange(
    seqId: number,
    queryStart: number,
    queryEnd: number,
  ) {
    const seqEntries = (await this.getIndex())[seqId]
    if (!seqEntries) {
      return []
    }

    const compare = (entry: Slice) => {
      const entryStart = entry.start
      const entryEnd = entry.start + entry.span
      if (entryStart > queryEnd) {
        return -1
      } // entry is ahead of query
      if (entryEnd <= queryStart) {
        return 1
      } // entry is behind query
      return 0 // entry overlaps query
    }
    const bins = []
    for (let i = 0; i < seqEntries.length; i += 1) {
      if (compare(seqEntries[i]) === 0) {
        bins.push(seqEntries[i])
      }
    }
    return bins
  }
}
