import { buildRFSchema, parseTagData } from './decodeRecord.ts'
import { CramMalformedError } from '../../errors.ts'
import ExternalCodec, { batchDecodeItf8 } from '../codecs/external.ts'
import { dataSeriesTypes } from '../container/compressionScheme.ts'
import {
  externalQualityColumn,
  growableQualityColumn,
  trimQualityColumn,
} from '../qualityColumn.ts'
import ReadFeatureArena from '../readFeatureArena.ts'
import TagColumn, { TAG_CHAR, TAG_NUMBER } from '../tagColumn.ts'
import { readNullTerminatedStringFromBuffer } from '../util.ts'

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
import type { TagValue } from '../tagColumn.ts'

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

  // Bulk read-base decoder — a view straight off the BA block when its codec
  // can hand one out (ExternalCodec can), undefined otherwise, in which case
  // decodeReadBases falls back to reading a base at a time
  const baCodec = compressionScheme.getCodecForDataSeries('BA')
  const decodeBulkBases: BulkBasesDecoder | undefined =
    baCodec?.bindBytesReader(blocksByContentId, cursors)

  // Read names come out of the RN codec as a string rather than as bytes the
  // record decoder then decodes, so that a codec able to decode its whole block
  // at once can. byteArrayStop is, and is what 49 of the 51 indexed fixtures
  // use for RN; the rest fall back to decoding a name at a time.
  const rnCodec = compressionScheme.getCodecForDataSeries('RN')
  const decodeReadName =
    rnCodec?.bindStringReader(coreDataBlock, blocksByContentId, cursors) ??
    (() => readNullTerminatedStringFromBuffer(bd.RN()))

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

  const tagColumn = new TagColumn()

  return {
    bd,
    rfSchema: buildRFSchema(bd, majorVersion),
    arena: new ReadFeatureArena(),
    qualityColumn,
    tagColumn,
    tagDescriptorsByTL: bindTagReaders(
      compressionScheme,
      blocksByContentId,
      coreDataBlock,
      cursors,
      tagColumn,
    ),
    cursors,
    decodeBulkBases,
    decodeReadName,
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
 * Build bound decode functions per data series.
 *
 * Each codec binds itself — see `CramCodec.bindDecoder` — so the per-slice
 * lookups (find the content block, find its cursor, join the pre-decoded int
 * block) happen once here rather than on every record. This used to be an
 * `instanceof` chain that reimplemented each codec's read inline, which meant
 * a codec combination the chain did not name paid full dispatch per record.
 *
 * The bound decoders are assembled into a single object literal with all data
 * series present so V8 sees a stable hidden class — call sites in decodeRecord
 * then become direct property accesses with monomorphic inline caches.
 */
function bindDataSeriesDecoders(
  compressionScheme: CramContainerCompressionScheme,
  blocksByContentId: Record<number, CramFileBlock>,
  coreDataBlock: CramFileBlock | undefined,
  cursors: Cursors,
): BoundDecoders {
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
    return codec.bindDecoder(coreDataBlock, blocksByContentId, cursors)
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
 * Tag types whose value is a fixed number of bytes the caller wants as a
 * number, and how many bytes that is. `f` is left out deliberately: its four
 * bytes are an IEEE float rather than an integer, so it keeps the byte-array
 * path. So do `B` and `H`, which are not scalars at all.
 */
const FIXED_WIDTH_TAG_TYPES: Record<string, number | undefined> = {
  A: 1,
  C: 1,
  c: 1,
  S: 2,
  s: 2,
  I: 4,
  i: 4,
}

/**
 * Turn the raw little-endian integer into what the tag type means: the value
 * itself for the unsigned types, and a sign-extension for the signed ones —
 * shifting the sign bit up to bit 31 and back down, which is the same arithmetic
 * at all three widths.
 *
 * `A` is not special-cased here any more. It reads as its character code and
 * {@link TagColumn} turns that back into a one-character string on access, which
 * keeps `A` tags in the numeric column — worth having, because `tp` is one of
 * minimap2's eleven per-read tags and so accounts for half of all non-numeric
 * tag values on a short-read file.
 */
function bindFixedWidthTagReader(
  type: string,
  width: number,
  readUint: () => number,
): () => TagValue {
  if (type === 'A' || type === 'C' || type === 'S' || type === 'I') {
    return readUint
  }
  const shift = 32 - width * 8
  return () => ((readUint() << shift) >> shift) | 0
}

/**
 * Bound tag readers, indexed by TL data series value.
 *
 * Every tag binds through its own codec, the same as a data series does, so a
 * byteArrayLength tag reads its length through whatever codec the file named
 * and takes its value as a view off the block. The three-character tag ids are
 * split into name and type here too, once per slice rather than once per tag
 * per record — and because the type is then known, the reader dispatches on it
 * here as well, rather than running `parseTagData`'s comparison chain on every
 * tag of every record.
 *
 * A Z tag whose codec can decode its whole block at once takes that path, the
 * same as a read name. CRAM delimits Z values with a tab and keeps BAM's
 * trailing NUL inside them, so the terminator is stripped from the string
 * rather than consumed as the delimiter.
 */
function bindTagReaders(
  compressionScheme: CramContainerCompressionScheme,
  blocksByContentId: Record<number, CramFileBlock>,
  coreDataBlock: CramFileBlock | undefined,
  cursors: Cursors,
  tagColumn: TagColumn,
) {
  const boundTagReaders: Record<string, () => TagValue> = {}
  for (const tagId of Object.keys(compressionScheme.tagEncoding)) {
    const type = tagId[2]!
    const codec = compressionScheme.getCodecForTag(tagId)
    if (type === 'Z') {
      const readString = codec.bindStringReader(
        coreDataBlock,
        blocksByContentId,
        cursors,
      )
      if (readString) {
        boundTagReaders[tagId] = readString
        continue
      }
    }
    const width = FIXED_WIDTH_TAG_TYPES[type]
    if (width !== undefined) {
      const readUint = codec.bindUintReader(
        width,
        coreDataBlock,
        blocksByContentId,
        cursors,
      )
      if (readUint) {
        boundTagReaders[tagId] = bindFixedWidthTagReader(type, width, readUint)
        continue
      }
    }
    const decode = codec.bindDecoder(coreDataBlock, blocksByContentId, cursors)
    // a tag codec is instantiated as byteArray, so this is a Uint8Array in
    // practice; the number arm covers a codec that decodes to one directly
    boundTagReaders[tagId] = () => {
      const data = decode()
      return typeof data === 'number' ? data : parseTagData(type, data)
    }
  }

  return compressionScheme.tagIdsDictionary.map(tagIds =>
    tagIds.map(tagId => {
      const type = tagId[2]!
      return {
        keyId: tagColumn.keyIdFor(tagId.slice(0, 2)),
        // Only `A` versus everything-else, resolved here once per tag id per
        // slice. The record loop dispatches on the decoded value's own type for
        // the rest, and TAG_STRING/TAG_ARRAY are set by the column's push
        // methods; a character code is the one case a value cannot self-report,
        // since it arrives as a plain number.
        kind: type === 'A' ? TAG_CHAR : TAG_NUMBER,
        read:
          boundTagReaders[tagId] ??
          (() => {
            throw new CramMalformedError(
              `tag ${tagId} is in the tag dictionary but has no encoding`,
            )
          }),
      }
    }),
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
  // the tag column is reached through the records' `tagColumn` reference rather
  // than by value, so trimming its arrays needs no re-pointing
  ctx.tagColumn.trim()

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
