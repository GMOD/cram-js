import { buildRFSchema } from './decodeRecord.ts'
import { CramBufferOverrunError, CramMalformedError } from '../../errors.ts'
import ByteArrayStopCodec from '../codecs/byteArrayStop.ts'
import ExternalCodec, {
  batchDecodeItf8,
  parseItf8,
} from '../codecs/external.ts'
import { dataSeriesTypes } from '../container/compressionScheme.ts'
import {
  externalQualityColumn,
  growableQualityColumn,
  trimQualityColumn,
} from '../qualityColumn.ts'
import ReadFeatureArena from '../readFeatureArena.ts'

import type { Cursor, Cursors, PreDecodedIntBlock } from '../codecs/_base.ts'
import type { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes.ts'
import type CramContainerCompressionScheme from '../container/compressionScheme.ts'
import type { CramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type CramRecord from '../record.ts'
import type {
  BoundDecoders,
  BulkBasesDecoder,
  ByteArraySeries,
  NumericSeries,
  SliceDecodeContext,
} from './decodeRecord.ts'

// shared zero-length sentinel returned by bound tag decoders when length=0
const EMPTY_BYTES = new Uint8Array(0)

export interface SliceDecodeContextArgs {
  compressionScheme: CramContainerCompressionScheme
  blocksByContentId: Record<number, CramFileBlock>
  coreDataBlock: CramFileBlock | undefined
  majorVersion: number
  /** the slice's reference id: >= 0 single-reference, -2 multi-reference */
  refSeqId: number
  /** 0-based reference start from the slice header, the seed for AP deltas */
  refSeqStart: number
  decodeTags: boolean
}

/**
 * Everything a slice's records decode against, assembled once before the record
 * loop runs.
 *
 * This is a pure function of the compression scheme and the slice's blocks —
 * nothing here reads the file — and it is where the per-slice work that used to
 * dominate `CramSlice._fetchRecords` lives: classifying external blocks as int
 * or byte, pre-decoding the int ones, binding a decoder per data series and per
 * tag, and opening the read-feature and quality columns.
 */
export function buildSliceDecodeContext({
  compressionScheme,
  blocksByContentId,
  coreDataBlock,
  majorVersion,
  refSeqId,
  refSeqStart,
  decodeTags,
}: SliceDecodeContextArgs): SliceDecodeContext {
  // tracks the read position within the block. codec.decode() methods
  // advance the byte and bit positions in the cursor as they decode
  // data note that we are only decoding a single block here, the core
  // data block
  const externalCursorMap = new Map<number, Cursor>()
  const cursors: Cursors = {
    lastAlignmentStart: refSeqStart,
    coreBlock: { bitPosition: 7, bytePosition: 0 },
    externalBlocks: {
      getCursor(contentId: number) {
        let r = externalCursorMap.get(contentId)
        if (r === undefined) {
          r = { bitPosition: 7, bytePosition: 0 }
          externalCursorMap.set(contentId, r)
        }
        return r
      },
    },
    preDecodedIntBlocks: preDecodeIntBlocks(
      compressionScheme,
      blocksByContentId,
    ),
  }

  const bd = bindDataSeriesDecoders(
    compressionScheme,
    blocksByContentId,
    coreDataBlock,
    cursors,
  )

  // Bulk read-base decoder — getBytesSubarray returns a subarray view when the
  // codec supports it (e.g. ExternalCodec), or undefined otherwise
  const baCodec = compressionScheme.getCodecForDataSeries('BA')
  const decodeBulkBases: BulkBasesDecoder | undefined = baCodec
    ? length => baCodec.getBytesSubarray(blocksByContentId, cursors, length)
    : undefined

  // Quality scores go into one column shared by the whole slice rather than a
  // Uint8Array per record. When QS is a plain external block that column is
  // the block itself — the scores are already laid out end to end in record
  // order, so nothing is copied and a record just remembers its offset.
  const qsCodec = compressionScheme.getCodecForDataSeries('QS')
  const qsBlock =
    qsCodec instanceof ExternalCodec
      ? blocksByContentId[qsCodec.parameters.blockContentId]
      : undefined
  const qualityColumn = qsBlock
    ? externalQualityColumn(
        qsBlock.content,
        cursors.externalBlocks.getCursor(qsBlock.contentId),
      )
    : growableQualityColumn()

  return {
    bd,
    rfSchema: buildRFSchema(bd, majorVersion),
    arena: new ReadFeatureArena(),
    qualityColumn,
    tagDescriptorsByTL: bindTagDecoders(
      compressionScheme,
      blocksByContentId,
      coreDataBlock,
      cursors,
    ),
    cursors,
    decodeBulkBases,
    decodeTags,
    APdelta: compressionScheme.APdelta,
    readNamesIncluded: compressionScheme.readNamesIncluded,
    isMultiRef: majorVersion > 1 && refSeqId === -2,
    refSeqId,
  }
}

/**
 * Batch ITF8-decode the external blocks that are only ever read as ints, so
 * that `ExternalCodec.decode()` becomes an array index read.
 *
 * A block only qualifies if *every* accessor treats it as an int; one
 * byte-typed accessor on the same block disqualifies it.
 */
function preDecodeIntBlocks(
  compressionScheme: CramContainerCompressionScheme,
  blocksByContentId: Record<number, CramFileBlock>,
) {
  const externalIntBlockIds = new Set<number>()
  const externalByteBlockIds = new Set<number>()

  // Recurse through codec encodings to find which external block IDs are
  // used as int vs byte. codecId 1 = EXTERNAL, 4 = BYTE_ARRAY_LENGTH
  // (whose lengths sub-codec is int, values sub-codec is byte),
  // 5 = BYTE_ARRAY_STOP (always byte).
  function collectExternalBlockIds(
    enc: CramEncoding | undefined,
    isInt: boolean,
  ) {
    if (!enc) {
      return
    }
    if (enc.codecId === 1) {
      if (isInt) {
        externalIntBlockIds.add(enc.parameters.blockContentId)
      } else {
        externalByteBlockIds.add(enc.parameters.blockContentId)
      }
    } else if (enc.codecId === 4) {
      collectExternalBlockIds(enc.parameters.lengthsEncoding, true)
      collectExternalBlockIds(enc.parameters.valuesEncoding, false)
    } else if (enc.codecId === 5) {
      externalByteBlockIds.add(enc.parameters.blockContentId)
    }
  }

  for (const [ds, enc] of Object.entries(
    compressionScheme.dataSeriesEncoding,
  )) {
    const dsType = dataSeriesTypes[ds as keyof typeof dataSeriesTypes]
    collectExternalBlockIds(enc, dsType === 'int')
  }
  for (const tagEnc of Object.values(compressionScheme.tagEncoding)) {
    collectExternalBlockIds(tagEnc, false)
  }

  // Remove any int block that is also used as byte
  for (const id of externalByteBlockIds) {
    externalIntBlockIds.delete(id)
  }

  const preDecodedIntBlocks = new Map<number, PreDecodedIntBlock>()
  for (const contentId of externalIntBlockIds) {
    const block = blocksByContentId[contentId]
    if (block?.content.length) {
      preDecodedIntBlocks.set(contentId, {
        values: batchDecodeItf8(block.content),
        index: 0,
      })
    }
  }
  return preDecodedIntBlocks
}

/**
 * Build bound decode functions per data series. For ExternalCodec this captures
 * the content buffer and cursor directly, eliminating per-call Record/Map
 * lookup overhead. The bound decoders are assembled into a single object
 * literal with all data series present so V8 sees a stable hidden class — call
 * sites in decodeRecord then become direct property accesses with monomorphic
 * inline caches.
 */
function bindDataSeriesDecoders(
  compressionScheme: CramContainerCompressionScheme,
  blocksByContentId: Record<number, CramFileBlock>,
  coreDataBlock: CramFileBlock | undefined,
  cursors: Cursors,
): BoundDecoders {
  const preDecodedIntBlocks = cursors.preDecodedIntBlocks

  // `bind` is a function declaration rather than an arrow so it can carry
  // overloads: the return type depends on the data series, per dataSeriesTypes
  function bind(dataSeriesName: NumericSeries): () => number
  function bind(dataSeriesName: ByteArraySeries): () => Uint8Array
  function bind(
    dataSeriesName: DataSeriesEncodingKey,
  ): () => number | Uint8Array {
    const codec = compressionScheme.getCodecForDataSeries(dataSeriesName)
    if (!codec) {
      return () => {
        throw new CramMalformedError(
          `no codec defined for ${dataSeriesName} data series`,
        )
      }
    }
    if (codec instanceof ExternalCodec) {
      const bid = codec.parameters.blockContentId
      const preDecoded = preDecodedIntBlocks?.get(bid)
      if (preDecoded) {
        const { values } = preDecoded
        // bounds check mirrors the byte branch below — without it a
        // truncated block silently yields undefined, which propagates as
        // NaN through alignmentStart/readLength rather than erroring
        return () => {
          const value = values[preDecoded.index++]
          if (value === undefined) {
            throw new CramBufferOverrunError(
              'attempted to read beyond end of block. this file seems truncated.',
            )
          }
          return value
        }
      }
      const contentBlock = blocksByContentId[bid]
      if (!contentBlock) {
        return () => {
          throw new CramMalformedError(`no block found with content ID ${bid}`)
        }
      }
      const cursor = cursors.externalBlocks.getCursor(bid)
      const content = contentBlock.content
      if (codec.dataType === 'int') {
        return () => parseItf8(content, cursor)
      }
      // Mirror the bounds check in ExternalCodec.decode — without it,
      // a truncated/corrupt block silently yields `undefined` for byte
      // reads, which downstream propagates as NaN/0 (silent data
      // corruption) rather than a clear error.
      return () => {
        const value = content[cursor.bytePosition++]
        if (value === undefined) {
          throw new CramBufferOverrunError(
            'attempted to read beyond end of block. this file seems truncated.',
          )
        }
        return value
      }
    }
    if (codec instanceof ByteArrayStopCodec) {
      const { blockContentId, stopByte } = codec.parameters
      const contentBlock = blocksByContentId[blockContentId]
      if (!contentBlock) {
        return () => {
          throw new CramMalformedError(
            `no block found with content ID ${blockContentId}`,
          )
        }
      }
      const content = contentBlock.content
      const cursor = cursors.externalBlocks.getCursor(blockContentId)
      return () => {
        const start = cursor.bytePosition
        const len = content.length
        let pos = start
        while (pos < len && content[pos] !== stopByte) {
          pos++
        }
        if (pos >= len) {
          throw new CramBufferOverrunError(
            'byteArrayStop reading beyond length of data buffer?',
          )
        }
        cursor.bytePosition = pos + 1
        return content.subarray(start, pos)
      }
    }
    return () => codec.decode(coreDataBlock!, blocksByContentId, cursors)
  }

  return {
    BF: bind('BF'),
    CF: bind('CF'),
    RI: bind('RI'),
    RL: bind('RL'),
    AP: bind('AP'),
    RG: bind('RG'),
    RN: bind('RN'),
    MF: bind('MF'),
    NS: bind('NS'),
    NP: bind('NP'),
    TS: bind('TS'),
    NF: bind('NF'),
    TL: bind('TL'),
    FN: bind('FN'),
    FC: bind('FC'),
    FP: bind('FP'),
    DL: bind('DL'),
    BB: bind('BB'),
    QQ: bind('QQ'),
    BS: bind('BS'),
    IN: bind('IN'),
    RS: bind('RS'),
    PD: bind('PD'),
    HC: bind('HC'),
    SC: bind('SC'),
    MQ: bind('MQ'),
    BA: bind('BA'),
    QS: bind('QS'),
    TC: bind('TC'),
    TN: bind('TN'),
  }
}

/**
 * Bound tag decoders, indexed by TL data series value.
 *
 * Tags are typically encoded as byteArrayLength (codecId=4) wrapping
 * External-int lengths + External-byte values. We build a fast closure per
 * tagId that inlines the length read and value subarray, eliminating per-call
 * dispatch through ByteArrayLengthCodec and the inner codecs. Other encodings
 * fall back to the generic dispatch.
 *
 * The three-character tag ids are also split into name and type here, once per
 * slice rather than once per tag per record.
 */
function bindTagDecoders(
  compressionScheme: CramContainerCompressionScheme,
  blocksByContentId: Record<number, CramFileBlock>,
  coreDataBlock: CramFileBlock | undefined,
  cursors: Cursors,
) {
  const preDecodedIntBlocks = cursors.preDecodedIntBlocks
  const boundTagDecoders: Record<
    string,
    () => Uint8Array | number | undefined
  > = {}
  const bindTagFallback = (tagId: string) => {
    const codec = compressionScheme.getCodecForTag(tagId)
    return () => codec.decode(coreDataBlock!, blocksByContentId, cursors)
  }
  for (const tagId of Object.keys(compressionScheme.tagEncoding)) {
    const enc = compressionScheme.tagEncoding[tagId]!
    if (
      enc.codecId === 4 &&
      enc.parameters.lengthsEncoding.codecId === 1 &&
      enc.parameters.valuesEncoding.codecId === 1
    ) {
      const lenBid = enc.parameters.lengthsEncoding.parameters.blockContentId
      const valBid = enc.parameters.valuesEncoding.parameters.blockContentId
      const lenContentBlock = blocksByContentId[lenBid]
      const valContentBlock = blocksByContentId[valBid]
      if (!lenContentBlock || !valContentBlock) {
        boundTagDecoders[tagId] = bindTagFallback(tagId)
        continue
      }
      const valContent = valContentBlock.content
      const valCursor = cursors.externalBlocks.getCursor(valBid)
      const lenPreDecoded = preDecodedIntBlocks?.get(lenBid)
      const lenContent = lenContentBlock.content
      const lenCursor = cursors.externalBlocks.getCursor(lenBid)
      const readTagLen = lenPreDecoded
        ? () => {
            const length = lenPreDecoded.values[lenPreDecoded.index++]
            if (length === undefined) {
              throw new CramBufferOverrunError(
                'attempted to read beyond end of block. this file seems truncated.',
              )
            }
            return length
          }
        : () => parseItf8(lenContent, lenCursor)
      boundTagDecoders[tagId] = () => {
        const length = readTagLen()
        if (length === 0) {
          return EMPTY_BYTES
        }
        const start = valCursor.bytePosition
        const end = start + length
        if (end > valContent.length) {
          throw new CramBufferOverrunError(
            'attempted to read beyond end of block. this file seems truncated.',
          )
        }
        valCursor.bytePosition = end
        return valContent.subarray(start, end)
      }
    } else {
      boundTagDecoders[tagId] = bindTagFallback(tagId)
    }
  }

  return compressionScheme.tagIdsDictionary.map(tagIds =>
    tagIds.map(tagId => ({
      name: tagId.slice(0, 2),
      type: tagId[2]!,
      decode:
        boundTagDecoders[tagId] ??
        (() => {
          throw new CramMalformedError(
            `tag ${tagId} is in the tag dictionary but has no encoding`,
          )
        }),
    })),
  )
}

/**
 * Hand back the capacity the columns over-allocated while decoding. Both grow
 * geometrically, so either can be holding up to twice what it needs, and both
 * outlive the decode in the record cache.
 */
export function trimSliceColumns(
  ctx: SliceDecodeContext,
  records: CramRecord[],
) {
  ctx.arena.trim()

  // trimming replaces the array, so the records handed the untrimmed one need
  // re-pointing; an external column is the QS block and never moved
  if (ctx.qualityColumn.cursor === undefined) {
    trimQualityColumn(ctx.qualityColumn)
    for (const record of records) {
      if (record.qualityColumn !== undefined) {
        record.qualityColumn = ctx.qualityColumn.bytes
      }
    }
  }
}
