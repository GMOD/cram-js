import { SharedReadCache } from '@gmod/shared-read-cache'
import crc32 from 'crc/calculators/crc32'

import {
  CramArgumentError,
  CramMalformedError,
  CramUnimplementedError,
} from '../errors.ts'
import { open } from '../io.ts'
import { getSharedSliceWorkerPool } from '../sliceWorkerPool.ts'
import CramContainer from './container/index.ts'
import { baseRecordClass } from './decodedSlice.ts'
import { memoizeAsync } from './memoize.ts'
import { parseBlockFromBuffer, uncompressBlockContent } from './parseBlock.ts'
import { parseHeaderText } from '../sam.ts'
import {
  type BlockHeader,
  type CompressionMethod,
  cramFileDefinition,
  getSectionParsers,
} from './sectionParsers.ts'
import { decodeUtf8, parseItem } from './util.ts'

import type DecodedSlice from './decodedSlice.ts'
import type { CramRecordClass } from './decodedSlice.ts'
import type CramRecord from './record.ts'
import type { BaseOpts, ReadOpts } from '../opts.ts'
import type { SharedBudget } from '@gmod/shared-read-cache'
import type { GenericFilehandle } from 'generic-filehandle2'

/**
 * Drop a decoded slice nothing has looked at for three minutes.
 *
 * The byte budget is enforced when a decode settles, so it does nothing at
 * all for a consumer sitting still — and jbrowse's `CramAdapter` memoizes one
 * `IndexedCramFile` for the life of the track, so without this a tab parked on
 * a region holds its whole last view until the track is closed, times every
 * track open.
 *
 * Three minutes rather than seconds because the target is a user who has gone
 * away, not one reading the screen in front of them: a pan back a minute later
 * should still hit. Matches @gmod/bam's DEFAULT_CACHE_IDLE_TIMEOUT_MS.
 */
export const DEFAULT_CACHE_IDLE_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Bytes to keep in the decoded-slice cache: 1 GB, the same number as
 * @gmod/bam's `DEFAULT_MAX_CACHE_BYTES`, so one `cacheBudget` can span both.
 *
 * Sized to hold several queries rather than part of one. Below a single query's
 * working set a budget does not cache less, it caches nothing — each slice
 * evicted before the next pan reuses it. The largest working sets measured on
 * the jb2bench CRAMs (ADR 0004) are a 50kb window at 1000x: 420,000 short
 * reads at ~400 B each, or 2,991 long reads at ~95 KB of read features each,
 * ~175 MB and ~285 MB. Both clear this with room, and the six-window pan there
 * went from 3167ms to 279ms once the budget cleared the working set.
 *
 * Until v14 this was 1,000,000 *records*, because a record object had no cheap
 * size; a slice of columns does (ADR 0013).
 *
 * Affordable only alongside DEFAULT_CACHE_IDLE_TIMEOUT_MS, which makes it a
 * peak under panning rather than a level a parked consumer holds.
 */
export const DEFAULT_MAX_CACHE_BYTES = 1024 * 1024 * 1024

// source: https://abdulapopoola.com/2019/01/20/check-endianness-with-javascript/
let isLittleEndian: boolean | undefined
function checkLittleEndian() {
  if (isLittleEndian === undefined) {
    isLittleEndian =
      new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44
  }
  return isLittleEndian
}

export interface CramFileSource {
  filehandle?: GenericFilehandle
  url?: string
  path?: string
}

/**
 * Fetch reference bases for `[start, end)` — 0-based half-open, so the returned
 * string must be exactly `end - start` characters. Both call sites check that
 * length, which is what turns a callback still written against the pre-v10
 * 1-based closed contract into an error rather than bases shifted by one.
 *
 * `refName` is the `@SQ` `SN` for `seqId`, so a callback can hand coordinates
 * straight to a name-keyed sequence source instead of the caller maintaining
 * its own id->name table. Only `undefined` for a CRAM with no `@SQ` lines.
 *
 * `opts.signal` is the signal of the query that needs these bases, for a
 * callback whose sequence source is itself remote. Ignoring it is fine — the
 * query still rejects on abort, at the next point the decode checks — so a
 * four-argument callback written before v10.6 keeps working unchanged.
 */
export type SeqFetch = (
  seqId: number,
  start: number,
  end: number,
  refName: string | undefined,
  opts?: BaseOpts,
) => Promise<string>

/** One `@SQ` line of the SAM header. */
export interface ReferenceInfo {
  /** `SN` */
  name: string
  /** `LN` */
  length: number
  /** `M5`, when the header records one */
  md5?: string
}

function parseReferenceInfo(
  header: ReturnType<typeof parseHeaderText>,
): ReferenceInfo[] {
  return header
    .filter(line => line.tag === 'SQ')
    .map((line, refId) => {
      const name = line.data.find(item => item.tag === 'SN')?.value
      const length = line.data.find(item => item.tag === 'LN')?.value
      if (name === undefined || length === undefined) {
        throw new CramMalformedError(
          `@SQ line ${refId} is missing its ${name === undefined ? 'SN' : 'LN'} tag`,
        )
      }
      return {
        name,
        length: Number(length),
        md5: line.data.find(item => item.tag === 'M5')?.value,
      }
    })
}

/**
 * Everything a `CramFile` takes except where the bytes come from.
 *
 * Split out from {@link CramFileArgs} so `IndexedCramFile` can forward the whole
 * set structurally instead of naming each field. It named them, and that is how
 * `useSliceWorkerPool` and `numSliceWorkers` came to be documented options that
 * no consumer could reach: the only public entry point silently dropped them.
 * Add options here and both constructors take them.
 */
export interface CramFileOptions<T extends CramRecord = CramRecord> {
  /**
   * Verify each slice's recorded reference MD5 against the sequence it is being
   * decoded with. Default false — the check needs the slice's whole reference
   * span, which can be many megabases the query would not otherwise fetch.
   */
  checkSequenceMD5?: boolean
  /**
   * Budget for the decoded-slice cache, in bytes. Defaults to
   * {@link DEFAULT_MAX_CACHE_BYTES}.
   *
   * A slice weighs what its columns retain — `DecodedSlice.byteLength`, the
   * typed arrays exactly and the strings by estimate, within a few percent of
   * the measured heap (ADR 0013). A **retention** bound, not a bound on peak
   * memory: reads in flight, the last settled entry, and everything a query
   * holds until it returns sit outside it.
   *
   * Size it to hold several queries. Below one query's working set it does not
   * cache less, it caches nothing: each slice is evicted before the next pan
   * can reuse it, so the hit rate is zero while the memory is retained anyway.
   */
  maxCacheBytes?: number
  /**
   * Drop a decoded slice once nothing has asked for it for this many
   * milliseconds. Defaults to {@link DEFAULT_CACHE_IDLE_TIMEOUT_MS}; `0` keeps
   * slices until `maxCacheBytes` evicts them.
   *
   * The only thing that lowers the cache while nothing is happening.
   * `maxCacheBytes` is enforced when a decode settles, so an idle cache stays
   * wherever it got to — and jbrowse's `CramAdapter` memoizes one
   * `IndexedCramFile` for the life of the track, so a tab parked on a region
   * holds its whole last view until the track is closed, times every track
   * open.
   *
   * Timed from the last read of a slice, not from when it was decoded, so
   * panning back and forth over one region never expires it.
   */
  cacheIdleTimeoutMs?: number
  /**
   * A budget shared with other `CramFile`s — and with any other
   * `@gmod/shared-read-cache` consumer that weighs in bytes, @gmod/bam among
   * them — so that {@link maxCacheBytes} applies to their sum rather than to
   * each of them.
   *
   * A per-file ceiling is not a bound on a consumer that opens one file per
   * track, and jbrowse's `CramAdapter` memoizes one `IndexedCramFile` for the
   * life of the track. @gmod/bam measured what that costs: six tracks browsing
   * six windows retained 1442 MB with every cache still under its own ceiling,
   * so nothing was bounding the sum (its ADR 0018).
   */
  cacheBudget?: SharedBudget
  fetchReferenceSequence?: SeqFetch
  /**
   * Check every block's CRC32 as it is read. Default false.
   *
   * What it buys is the difference between a damaged file and wrong records.
   * Flipping one byte at each of 200 positions through
   * `SRR396637.sorted.clip.cram`, plus 40 truncations: with this on, all 240
   * raise a `CramError`. With it off, 69 still do — the damage lands
   * somewhere a length or a codec notices — but two decode to 54,695 records
   * that differ from the pristine ones, with nothing to say so. A byte inside
   * an external block is only recoverable from the CRC.
   *
   * Off by default because most consumers read their own files over a
   * checksummed transport and the decode is the cost they care about.
   */
  validateChecksums?: boolean
  /**
   * Decode slices on a shared pool of workers. Default true, and a no-op
   * wherever workers cannot be launched — node, or a browser context without
   * Blob URLs — where the decode simply stays in-process.
   *
   * Worth having because a slice decode is the expensive part of a query and
   * slices are independent: at jb2bench's 19kb region a query touches 16 slices
   * on 1000x-coverage short reads and 22 on long reads. Even at one slice, the
   * decode is off the main thread, which is what a UI notices.
   *
   * Leave it on inside another worker. This used to say a nested pool "buys
   * nothing" for a consumer already running `@gmod/cram` in its own worker,
   * which was a guess and is measured wrong: nested in a browser worker — the
   * arrangement jbrowse ships — the pool is worth 2.1-3.6x from four slices up,
   * and parity at one. A worker is still one thread, so the decode is serial in
   * there without this. See docs/workers.md.
   *
   * Set false to keep everything in-process. The reason to is host-wide worker
   * budget rather than per-query speed: the pool is process-wide *per JS
   * context*, so a consumer that runs several worker contexts gets one pool in
   * each, and `numSliceWorkers` is how to size that down.
   */
  useSliceWorkerPool?: boolean
  /**
   * Workers in the shared pool. Defaults to
   * `min(navigator.hardwareConcurrency, 4)`.
   *
   * Only honoured by whoever creates the pool: the pool is shared, so the first
   * `CramFile` to need one fixes the size. A consumer opening one file per track
   * wants that — a pool per track would put `4 x tracks` workers on the machine.
   *
   * Shared **per JS context**, though, which is not the same as per machine once
   * the consumer is itself running workers. jbrowse assigns tracks round-robin
   * over as many as five RPC workers, so five CRAM tracks land in five contexts
   * and get five pools: 4 x 5 slice workers, not 4. Size this down if the host
   * spreads CRAM across contexts like that.
   */
  numSliceWorkers?: number
  /**
   * A subclass of `CramRecord` to hand out from every query in place of the
   * base class, so that a consumer with its own per-read object — a feature,
   * say — can be that object rather than wrap one. Constructed as
   * `new RecordClass(slice, index)`; anything else it needs it takes off the
   * record it is. The same hook `@gmod/bam` offers under the same name.
   */
  recordClass?: CramRecordClass<T>
}

export type CramFileArgs<T extends CramRecord = CramRecord> = CramFileSource &
  CramFileOptions<T>

export type CramFileBlock = BlockHeader & {
  _endPosition: number
  contentPosition: number
  _size: number
  content: Uint8Array
  crc32?: number
}

export default class CramFile<T extends CramRecord = CramRecord> {
  private file: GenericFilehandle
  public validateChecksums: boolean
  private useSliceWorkerPool: boolean
  private numSliceWorkers: number | undefined
  public fetchReferenceSequenceCallback?: SeqFetch
  public recordClass: CramRecordClass<T>
  public options: {
    checkSequenceMD5: boolean
    maxCacheBytes: number
  }
  public featureCache: SharedReadCache<string, DecodedSlice>
  private header: string | undefined
  // Deliberately signal-free, unlike every other memo in the read path. These
  // two are shared file-wide and fetched once for the life of the object — 26
  // bytes of definition, and the first container for the SAM header — so every
  // query after the first joins them already resolved. Threading a signal in
  // would mean the first query to arrive owns a read the whole file depends on,
  // and cancelling it on that one query's behalf is wrong however carefully the
  // sharing is handled.
  private _definitionMemo = memoizeAsync(() => this._fetchDefinition())
  private _samHeaderMemo = memoizeAsync(() => this._fetchSamHeader())
  private _referenceInfo?: ReferenceInfo[]

  /**
   * The shared slice-decode pool, or undefined when slices decode in-process.
   *
   * Resolved once and remembered, including the undefined: `getSharedSliceWorkerPool`
   * is cheap to call repeatedly but this runs once per slice, and a pool that
   * failed to start should not be retried per slice for the life of the file.
   */
  private _sliceWorkerPoolMemo = memoizeAsync(() =>
    this._fetchSliceWorkerPool(),
  )

  async getSliceWorkerPool() {
    return this._sliceWorkerPoolMemo()
  }

  private async _fetchSliceWorkerPool() {
    if (!this.useSliceWorkerPool) {
      return undefined
    }
    try {
      return await getSharedSliceWorkerPool(this.numSliceWorkers)
    } catch (e) {
      // A pool that will not start must not stop the file being read: the
      // caller falls back to decoding in-process. Warned once per file rather
      // than swallowed, because silently losing the parallelism is the kind of
      // thing that otherwise shows up as an unexplained slowdown.
      console.warn(
        `cram: could not start the slice worker pool, decoding in-process instead: ${String(e)}`,
      )
      return undefined
    }
  }

  constructor(args: CramFileArgs<T>) {
    this.file = open(args.url, args.path, args.filehandle)
    this.validateChecksums = args.validateChecksums ?? false
    this.useSliceWorkerPool = args.useSliceWorkerPool ?? true
    this.numSliceWorkers = args.numSliceWorkers
    this.fetchReferenceSequenceCallback = args.fetchReferenceSequence
    // the base class is the default for the default T, which the type of
    // `recordClass` cannot say on its own — the same cast @gmod/bam makes
    this.recordClass = args.recordClass ?? baseRecordClass<T>()
    this.options = {
      // off unless asked for: the check needs the whole span a slice was
      // written against, which for a big slice is many megabases the query
      // itself would never have fetched
      checkSequenceMD5: args.checkSequenceMD5 ?? false,
      maxCacheBytes: args.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES,
    }

    // cache of features in a slice, keyed by the slice offset. caches all of
    // the features in a slice, or none. the cache is actually used by the
    // slice object, it's just kept here at the level of the file
    this.featureCache = new SharedReadCache<string, DecodedSlice>({
      maxSize: this.options.maxCacheBytes,
      sizeOf: slice => slice.byteLength,
      // 'lru', the default, rather than the 'batch' policy this used until
      // 11.3.0. 'batch' was adopted when the budget was 20,000 records against
      // queries needing 420,000 -- it rescues an undersized budget by SPARING
      // whatever the batch touched, i.e. by exceeding the budget, measured
      // holding 420,000 against a limit of 20,000. Now that the default is
      // above the working set the two are measurably identical (same refill
      // counts, times inside noise), so keeping 'batch' bought nothing and cost
      // the budget its meaning: a consumer lowering it to constrain memory got
      // 21x what it asked for (ADR 0005).
      idleTimeoutMs: args.cacheIdleTimeoutMs ?? DEFAULT_CACHE_IDLE_TIMEOUT_MS,
      budget: args.cacheBudget,
    })
    if (!checkLittleEndian()) {
      throw new Error('Detected big-endian machine, may be unable to run')
    }
  }

  /**
   * Drops every decoded slice held by the feature cache, and stops the idle
   * sweep until something is cached again.
   *
   * The idle timeout reclaims a view the user has wandered away from, but a
   * consumer that *knows* it is finished — a closed track, a changed
   * assembly — should not have to wait three minutes for it. Mirrors
   * `BamFile.clearFeatureCache`.
   */
  clearFeatureCache() {
    this.featureCache.clear()
  }

  /**
   * Every byte the decode reads comes through here.
   *
   * The signal is checked before the read is issued as well as handed to the
   * filehandle, because honouring it is optional down there: `RemoteFile`
   * aborts the `fetch`, but `LocalFile` ignores the signal entirely and runs to
   * completion. The up-front check is what makes a cancelled query stop making
   * progress on a local file rather than reading the whole range anyway.
   */
  read(length: number, position: number, opts?: ReadOpts) {
    opts?.signal?.throwIfAborted()
    return this.file.read(length, position, opts)
  }

  // getSectionParsers is itself cached per major version — the parsers are pure
  // functions of (buffer, offset), so one set is shared by every file — which
  // is why there is no memo of its result here
  private async _getSectionParsers() {
    const { majorVersion } = await this.getDefinition()
    return getSectionParsers(majorVersion)
  }

  getDefinition() {
    return this._definitionMemo()
  }

  private async _fetchDefinition() {
    const { maxLength, parser } = cramFileDefinition()
    const headbytes = await this.file.read(maxLength, 0)
    const definition = parser(headbytes).value
    if (definition.magic !== 'CRAM') {
      // a CramMalformedError rather than a bare Error: "this is not the file you
      // think it is" is the single most likely thing a consumer wants to tell
      // apart from a network failure, and it is the first check every read hits
      throw new CramMalformedError(
        'Not a CRAM file, does not match magic string',
      )
    } else if (definition.majorVersion !== 2 && definition.majorVersion !== 3) {
      throw new CramUnimplementedError(
        `CRAM version ${definition.majorVersion} not supported`,
      )
    } else {
      return definition
    }
  }

  getSamHeader() {
    return this._samHeaderMemo()
  }

  private async _fetchSamHeader() {
    const firstContainer = await this.getContainerById(0)
    if (!firstContainer) {
      throw new CramMalformedError('file contains no containers')
    }

    const firstBlock = await firstContainer.getFirstBlock()

    const content = firstBlock.content
    const dataView = new DataView(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    )
    const headerLength = dataView.getInt32(0, true)
    const textStart = 4
    const text = decodeUtf8(
      content.subarray(textStart, textStart + headerLength),
    )
    this.header = text
    return parseHeaderText(text)
  }

  async getHeaderText() {
    await this.getSamHeader()
    return this.header
  }

  /**
   * The `@SQ` lines in header order. A reference's numeric ID — what
   * `getRecordsForRange` takes and `CramRecord.sequenceId` reports — is its
   * index here. Empty for a CRAM with no `@SQ` lines.
   */
  async getReferenceInfo() {
    this._referenceInfo ??= parseReferenceInfo(await this.getSamHeader())
    return this._referenceInfo
  }

  /**
   * Numeric ID for a reference name. Throws if the header has no such `SN` —
   * a name that is not in the file is a caller mistake, and returning `-1`
   * would collide with the ID unplaced reads use. Use `getReferenceInfo()` to
   * test for a name without throwing.
   */
  async getReferenceId(name: string) {
    const refId = (await this.getReferenceInfo()).findIndex(
      ref => ref.name === name,
    )
    if (refId === -1) {
      throw new CramArgumentError(
        `no @SQ line in the CRAM header named ${name}`,
      )
    }
    return refId
  }

  /**
   * Reference name for a numeric ID. Undefined for an ID with no `@SQ` line,
   * which is routine rather than a mistake: `-1` means unplaced, and a CRAM
   * with no `@SQ` lines at all has no names to give.
   */
  async getReferenceName(refId: number) {
    return (await this.getReferenceInfo())[refId]?.name
  }

  // Walk containers from the start of the file. Yields each container along
  // with its parsed header. The first container's length is recomputed by
  // reading all of its blocks because the recorded length cannot be trusted
  // (htslib bug); subsequent containers use header._size + header.length.
  private async *iterContainers() {
    const sectionParsers = await this._getSectionParsers()
    let position = sectionParsers.cramFileDefinition.maxLength
    let i = 0
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const container = this.getContainerAtPosition(position)
      const header = await container.getHeader()
      yield container
      if (i === 0) {
        position = header._endPosition
        for (let j = 0; j < header.numBlocks; j++) {
          const block = await this.readBlock(position)
          position = block._endPosition
        }
      } else {
        position += header._size + header.length
      }
      i++
    }
  }

  async getContainerById(containerNumber: number) {
    let i = 0
    for await (const container of this.iterContainers()) {
      if (i === containerNumber) {
        return container
      }
      i++
    }
    return undefined
  }

  async checkCrc32(
    position: number,
    length: number,
    recordedCrc32: number,
    description: string,
    opts?: ReadOpts,
  ) {
    this.checkCrc32Bytes(
      await this.read(length, position, opts),
      recordedCrc32,
      description,
    )
  }

  checkCrc32Bytes(
    bytes: Uint8Array,
    recordedCrc32: number,
    description: string,
  ) {
    // this shift >>> 0 is equivalent to crc32(b).unsigned but uses the
    // internal calculator of crc32 to avoid accidentally importing buffer
    // https://github.com/alexgorbatchev/crc/blob/31fc3853e417b5fb5ec83335428805842575f699/src/define_crc.ts#L5
    const calculatedCrc32 = crc32(bytes) >>> 0
    if (calculatedCrc32 !== recordedCrc32) {
      throw new CramMalformedError(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  /**
   * How many containers the file holds, not counting the EOF marker container.
   *
   * Nothing in a CRAM records this, so it is a walk from the start, and there
   * is no length to bound the walk either — it ends when a container fails to
   * parse, which is what reading past the end of the file looks like. The EOF
   * marker parses like any other container, so it is walked and then
   * subtracted: the number left is how many containers hold data, which is what
   * `getContainerById` indexes.
   *
   * A file whose very first container does not parse counts 0 rather than
   * reporting -1.
   *
   * Only used by the tests.
   */
  async containerCount(): Promise<number> {
    let parsed = 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _container of this.iterContainers()) {
        parsed += 1
      }
    } catch {
      // the failed read past the last container is how the walk terminates;
      // every container counted before it parsed cleanly
    }
    return Math.max(parsed - 1, 0)
  }

  getContainerAtPosition(position: number) {
    return new CramContainer(this, position)
  }

  /**
   * Kept as a method for its call sites; the work is in `parseBlock.ts`, which a
   * worker can reach without a `CramFile`.
   */
  _uncompress(
    compressionMethod: CompressionMethod,
    inputBuffer: Uint8Array,
    uncompressedSize: number,
  ): Promise<Uint8Array> {
    return uncompressBlockContent(
      compressionMethod,
      inputBuffer,
      uncompressedSize,
    )
  }

  async readBlock(position: number, opts?: ReadOpts) {
    const { majorVersion } = await this.getDefinition()
    const { cramBlockHeader, cramBlockCrc32 } = await this._getSectionParsers()

    const headerBuf = await this.read(cramBlockHeader.maxLength, position, opts)
    const blockHeader = parseItem(
      headerBuf,
      cramBlockHeader.parser,
      0,
      position,
    )

    const totalSize =
      blockHeader._size +
      blockHeader.compressedSize +
      (majorVersion >= 3 ? cramBlockCrc32.maxLength : 0)
    const fullBuffer = await this.read(totalSize, position, opts)

    return this.readBlockFromBuffer(fullBuffer, 0, position)
  }

  async readBlockFromBuffer(
    buffer: Uint8Array,
    bufferOffset: number,
    filePosition: number,
  ) {
    const { majorVersion } = await this.getDefinition()
    return parseBlockFromBuffer({
      buffer,
      bufferOffset,
      filePosition,
      majorVersion,
      sectionParsers: await this._getSectionParsers(),
      validateChecksums: this.validateChecksums,
    })
  }
}
