import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import QuickLRU from 'quick-lru'
import { unzip } from './unzip'
import { open } from './io'
import { CramMalformedError } from './errors'
import { CramFileSource } from './cramFile/file'
import { Filehandle } from './cramFile/filehandle'

const BAI_MAGIC = 21_578_050 // BAI\1

export interface Slice {
  start: number
  span: number
  containerStart: number
  sliceStart: number
  sliceBytes: number
}

type ParsedIndex = Record<string, Slice[] | undefined>

function addRecordToIndex(index: ParsedIndex, record: number[]) {
  const [seqId, start, span, containerStart, sliceStart, sliceBytes] = record

  const s = seqId!
  if (!index[s]) {
    index[s] = []
  }

  index[s].push({
    start: start!,
    span: span!,
    containerStart: containerStart!,
    sliceStart: sliceStart!,
    sliceBytes: sliceBytes!,
  })
}

function maybeUnzip(data: Buffer) {
  if (data[0] === 31 && data[1] === 139) {
    return unzip(data)
  }
  return data
}

export default class CraiIndex {
  // A CRAM index (.crai) is a gzipped tab delimited file containing the
  // following columns:
  //
  // 1. Sequence id
  // 2. Alignment start
  // 3. Alignment span
  // 4. Container start byte position in the file
  // 5. Slice start byte position in the container data (‘blocks’)
  // 6. Slice size in bytes
  // Each line represents a slice in the CRAM file. Please note that all slices must be listed in index file.
  private parseIndexP?: Promise<ParsedIndex>

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
  }

  async parseIndex(opts: { signal?: AbortSignal } = {}) {
    const index: ParsedIndex = {}
    const uncompressedBuffer = maybeUnzip(await this.filehandle.readFile(opts))
    if (
      uncompressedBuffer.length > 4 &&
      uncompressedBuffer.readUInt32LE(0) === BAI_MAGIC
    ) {
      throw new CramMalformedError(
        'invalid .crai index file. note: file appears to be a .bai index. this is technically legal but please open a github issue if you need support',
      )
    }
    // interpret the text as regular ascii, since it is
    // supposed to be only digits and whitespace characters
    // this is written in a deliberately low-level fashion for performance,
    // because some .crai files can be pretty large.
    let currentRecord: number[] = []
    let currentString = ''
    for (const charCode of uncompressedBuffer) {
      if (
        (charCode >= 48 && charCode <= 57) /* 0-9 */ ||
        (!currentString && charCode === 45) /* leading - */
      ) {
        currentString += String.fromCharCode(charCode)
      } else if (charCode === 9 /* \t */) {
        currentRecord.push(Number.parseInt(currentString, 10))
        currentString = ''
      } else if (charCode === 10 /* \n */) {
        currentRecord.push(Number.parseInt(currentString, 10))
        currentString = ''
        addRecordToIndex(index, currentRecord)
        currentRecord = []
      } else if (charCode !== 13 /* \r */ && charCode !== 32 /* space */) {
        // if there are other characters in the file besides
        // space and \r, something is wrong.
        throw new CramMalformedError('invalid .crai index file')
      }
    }

    // if the file ends without a \n, we need to flush our buffers
    if (currentString) {
      currentRecord.push(Number.parseInt(currentString, 10))
    }
    if (currentRecord.length === 6) {
      addRecordToIndex(index, currentRecord)
    }

    // sort each of them by start
    Object.entries(index).forEach(([seqId, ent]) => {
      const e2 = ent!
      index[seqId] = e2.sort((a, b) => a.start - b.start || a.span - b.span)
    })
    return index
  }

  getIndex(opts?: { signal?: AbortSignal }) {
    if (!this.parseIndexP) {
      this.parseIndexP = this.parseIndex(opts).catch(e => {
        this.parseIndexP = undefined
        throw e
      })
    }
    return this.parseIndexP
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
  ): Promise<Slice[]> {
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
    const bins = [] as Slice[]
    for (const entry of seqEntries) {
      if (compare(entry) === 0) {
        bins.push(entry)
      }
    }
    return bins
  }
}
