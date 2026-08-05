import { CramMalformedError } from './errors.ts'
import { open } from './io.ts'
import { unzip } from './unzip.ts'

import type { CramFileSource } from './cramFile/file.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

const BAI_MAGIC = 21_578_050 // BAI\1

export interface IndexOpts {
  signal?: AbortSignal
  /**
   * Called as the index (.crai) is downloaded, with cumulative downloaded bytes
   * and the total. The index is a whole-file read, so this streams real byte
   * progress. Lets callers show a determinate "downloading index" bar.
   */
  onProgress?: (bytesDownloaded: number, totalBytes?: number) => void
}

export interface Slice {
  /** 0-based start of the slice on the reference (the .crai stores 1-based) */
  start: number
  span: number
  containerStart: number
  sliceStart: number
  sliceBytes: number
}

type ParsedIndex = Record<string, Slice[] | undefined>

/**
 * The parsed index, plus what {@link CraiIndex.getEntriesForRange} needs to
 * binary-search it: the longest span of any slice on each reference, which
 * bounds how far back from a query's start an overlapping slice can begin.
 */
interface IndexData {
  bySeqId: ParsedIndex
  maxSpan: Record<string, number | undefined>
}

function maxSpanBySeqId(index: ParsedIndex) {
  const maxSpans: Record<string, number> = {}
  for (const [seqId, entries] of Object.entries(index)) {
    let max = 0
    for (const entry of entries ?? []) {
      if (entry.span > max) {
        max = entry.span
      }
    }
    maxSpans[seqId] = max
  }
  return maxSpans
}

const FIELDS_PER_RECORD = 6

function addRecordToIndex(index: ParsedIndex, fields: number[]) {
  const seqId = fields[0]!
  if (!index[seqId]) {
    index[seqId] = []
  }

  index[seqId].push({
    // the .crai column is 1-based; everything past this parse is 0-based
    start: fields[1]! - 1,
    span: fields[2]!,
    containerStart: fields[3]!,
    sliceStart: fields[4]!,
    sliceBytes: fields[5]!,
  })
}

async function maybeUnzip(data: Uint8Array) {
  return data[0] === 31 && data[1] === 139 ? unzip(data) : data
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
  //
  // Each line represents a slice in the CRAM file. Please note that all slices
  // must be listed in index file.
  private indexDataP?: Promise<IndexData>

  private filehandle: GenericFilehandle

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

  async parseIndex(opts: IndexOpts = {}) {
    const index: ParsedIndex = {}
    const uncompressedBuffer = await maybeUnzip(
      await this.filehandle.readFile({
        signal: opts.signal,
        onProgress: opts.onProgress,
      }),
    )
    const dataView = new DataView(
      uncompressedBuffer.buffer,
      uncompressedBuffer.byteOffset,
      uncompressedBuffer.byteLength,
    )
    if (
      uncompressedBuffer.length > 4 &&
      dataView.getUint32(0, true) === BAI_MAGIC
    ) {
      throw new CramMalformedError(
        'invalid .crai index file. note: file appears to be a .bai index. this is technically legal but please open a github issue if you need support',
      )
    }
    // Interpret the text as regular ascii, since it is supposed to be only
    // digits and whitespace characters. Digits are accumulated numerically
    // rather than into a string that is then parseInt'd: whole-genome .crai
    // files run to tens of megabytes, and the per-digit string building
    // dominated index load time.
    const fields: number[] = new Array(FIELDS_PER_RECORD)
    let fieldCount = 0
    let value = 0
    let negative = false
    let hasDigits = false
    const len = uncompressedBuffer.length
    for (let i = 0; i < len; i++) {
      const charCode = uncompressedBuffer[i]!
      if (charCode >= 48 && charCode <= 57 /* 0-9 */) {
        value = value * 10 + (charCode - 48)
        hasDigits = true
      } else if (charCode === 45 /* - */ && !hasDigits && !negative) {
        negative = true
      } else if (charCode === 9 /* \t */ || charCode === 10 /* \n */) {
        // a \n with nothing pending at the start of a record is a blank line
        if (charCode === 10 && fieldCount === 0 && !hasDigits && !negative) {
          continue
        }
        if (!hasDigits) {
          throw new CramMalformedError(
            'invalid .crai index file, empty numeric field',
          )
        }
        if (fieldCount === FIELDS_PER_RECORD) {
          throw new CramMalformedError(
            `invalid .crai index file, more than ${FIELDS_PER_RECORD} fields in a record`,
          )
        }
        fields[fieldCount++] = negative ? -value : value
        value = 0
        negative = false
        hasDigits = false
        if (charCode === 10) {
          if (fieldCount !== FIELDS_PER_RECORD) {
            throw new CramMalformedError(
              `invalid .crai index file, expected ${FIELDS_PER_RECORD} fields per record but got ${fieldCount}`,
            )
          }
          addRecordToIndex(index, fields)
          fieldCount = 0
        }
      } else if (charCode !== 13 /* \r */ && charCode !== 32 /* space */) {
        // if there are other characters in the file besides
        // space and \r, something is wrong.
        throw new CramMalformedError('invalid .crai index file')
      }
    }

    // if the file ends without a \n, we need to flush our buffers
    if (hasDigits && fieldCount < FIELDS_PER_RECORD) {
      fields[fieldCount++] = negative ? -value : value
    }
    if (fieldCount === FIELDS_PER_RECORD) {
      addRecordToIndex(index, fields)
    }

    // sort each of them by start
    for (const ent of Object.values(index)) {
      ent?.sort((a, b) => a.start - b.start || a.span - b.span)
    }
    return index
  }

  private getIndexData(opts: IndexOpts = {}) {
    if (!this.indexDataP) {
      this.indexDataP = this.parseIndex(opts)
        .then(bySeqId => ({ bySeqId, maxSpan: maxSpanBySeqId(bySeqId) }))
        .catch((e: unknown) => {
          this.indexDataP = undefined
          throw e
        })
    }
    return this.indexDataP
  }

  async getIndex(opts: IndexOpts = {}) {
    return (await this.getIndexData(opts)).bySeqId
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
   * @param {number} queryStart 0-based half-open
   * @param {number} queryEnd 0-based half-open
   *
   * @returns {Promise} promise for
   * an array of objects of the form
   * `{start, span, containerStart, sliceStart, sliceBytes }`
   */
  async getEntriesForRange(
    seqId: number,
    queryStart: number,
    queryEnd: number,
    opts: IndexOpts = {},
  ): Promise<Slice[]> {
    const { bySeqId, maxSpan } = await this.getIndexData(opts)
    const entries = bySeqId[seqId]
    if (!entries) {
      return []
    }

    // The entries are sorted by start, so both ends of the overlapping run can
    // be found rather than scanned for. A slice starting at or before
    // `queryStart - maxSpan` cannot reach the query however long it is, so that
    // bounds the search from below; past `queryEnd` nothing can overlap either,
    // so the forward scan stops rather than running to the end of the
    // reference.
    //
    // This used to filter the whole reference's entry list on every call. A
    // whole-genome .crai runs to hundreds of thousands of slices, and
    // `getRecordsForRange` with `viewAsPairs` calls this once per unmated read
    // — so a query returning n reads did O(n x slices) work before deduplicating
    // the slices it found down to a handful.
    const earliestStart = queryStart - (maxSpan[seqId] ?? 0)
    let lo = 0
    let hi = entries.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (entries[mid]!.start < earliestStart) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }

    const overlapping: Slice[] = []
    for (let i = lo; i < entries.length; i++) {
      const entry = entries[i]!
      if (entry.start >= queryEnd) {
        break
      }
      // the lower bound is only as tight as the longest span on the reference,
      // so each candidate still gets the real overlap test
      if (entry.start + entry.span > queryStart) {
        overlapping.push(entry)
      }
    }
    return overlapping
  }
}
