/**
 * Block decompression and parsing, as free functions.
 *
 * Both used to be `CramFile` methods, and neither ever needed the file: they
 * touch `majorVersion`, the section parsers and a checksum flag, all of which are
 * values rather than state. Lifting them out is what lets a **worker** turn a
 * slice's raw bytes into decompressed blocks — a `CramFile` cannot cross a worker
 * boundary (it holds a filehandle and a callback), but bytes plus three values
 * can, and moving decompression to the far side is worth having: it is 24-35% of
 * a cold query, and leaving it behind would cap a slice-decode pool at the
 * remaining two thirds.
 *
 * `CramFile` keeps thin methods that delegate here, so its own call sites and
 * anything reaching for them are unchanged.
 */
import crc32 from 'crc/calculators/crc32'

import { CramMalformedError, CramUnimplementedError } from '../errors.ts'
import * as htscodecs from '../htscodecs/index.ts'
import { unzip } from '../unzip.ts'
import { parseItem } from './util.ts'
import { xzDecompress } from '../xz-decompress/xz-decompress.ts'

import type { CramFileBlock } from './file.ts'
import type { CompressionMethod, getSectionParsers } from './sectionParsers.ts'

type SectionParsers = ReturnType<typeof getSectionParsers>

/** Decompress one block's content by the method its header names. */
export async function uncompressBlockContent(
  compressionMethod: CompressionMethod,
  inputBuffer: Uint8Array,
  uncompressedSize: number,
): Promise<Uint8Array> {
  let buf: Uint8Array
  if (compressionMethod === 'gzip') {
    buf = await unzip(inputBuffer, uncompressedSize)
  } else if (compressionMethod === 'bzip2') {
    buf = await htscodecs.bz2_uncompress(inputBuffer, uncompressedSize)
  } else if (compressionMethod === 'lzma') {
    buf = await xzDecompress(inputBuffer)
  } else if (compressionMethod === 'rans') {
    buf = await htscodecs.rans_uncompress(inputBuffer)
  } else if (compressionMethod === 'rans4x16') {
    buf = await htscodecs.r4x16_uncompress(inputBuffer)
  } else if (compressionMethod === 'arith') {
    buf = await htscodecs.arith_uncompress(inputBuffer)
  } else if (compressionMethod === 'fqzcomp') {
    buf = await htscodecs.fqzcomp_uncompress(inputBuffer)
  } else if (compressionMethod === 'tok3') {
    buf = await htscodecs.tok3_uncompress(inputBuffer)
  } else {
    throw new CramUnimplementedError(
      `${compressionMethod} decompression not yet implemented`,
    )
  }
  if (buf.length !== uncompressedSize) {
    throw new CramMalformedError(
      `${compressionMethod} decompression produced ${buf.length} bytes, expected ${uncompressedSize}`,
    )
  }
  return buf
}

/**
 * Parse one block out of `buffer` at `bufferOffset`, decompressing its content.
 *
 * `filePosition` is where `bufferOffset` sits in the file, and is used for the
 * positions the returned block reports and for CRC error messages — it does not
 * affect what is read.
 */
export async function parseBlockFromBuffer({
  buffer,
  bufferOffset,
  filePosition,
  majorVersion,
  sectionParsers,
  validateChecksums,
}: {
  buffer: Uint8Array
  bufferOffset: number
  filePosition: number
  majorVersion: number
  sectionParsers: SectionParsers
  validateChecksums: boolean
}): Promise<CramFileBlock> {
  const { cramBlockHeader } = sectionParsers

  const headerBytes = buffer.subarray(
    bufferOffset,
    bufferOffset + cramBlockHeader.maxLength,
  )
  const blockHeader = parseItem(
    headerBytes,
    cramBlockHeader.parser,
    0,
    filePosition,
  )
  const blockContentPosition = blockHeader._endPosition
  const contentOffset = bufferOffset + blockHeader._size

  const d = buffer.subarray(
    contentOffset,
    contentOffset + blockHeader.compressedSize,
  )
  // Per CRAM spec (PR #681), blocks with uncompressed size 0 are treated as
  // empty regardless of the method byte — htsjdk has produced invalid empty
  // RANS blocks that would otherwise fail to decompress.
  const uncompressedData =
    blockHeader.uncompressedSize === 0
      ? new Uint8Array(0)
      : blockHeader.compressionMethod !== 'raw'
        ? await uncompressBlockContent(
            blockHeader.compressionMethod,
            d,
            blockHeader.uncompressedSize,
          )
        : d

  const block: CramFileBlock = {
    ...blockHeader,
    _endPosition: blockContentPosition,
    contentPosition: blockContentPosition,
    content: uncompressedData,
  }
  if (majorVersion >= 3) {
    const crcOffset = contentOffset + blockHeader.compressedSize
    const crcBytes = buffer.subarray(
      crcOffset,
      crcOffset + sectionParsers.cramBlockCrc32.maxLength,
    )
    const crc = parseItem(
      crcBytes,
      sectionParsers.cramBlockCrc32.parser,
      0,
      blockContentPosition + blockHeader.compressedSize,
    )
    block.crc32 = crc.crc32

    if (validateChecksums) {
      const blockData = buffer.subarray(
        bufferOffset,
        bufferOffset + blockHeader._size + blockHeader.compressedSize,
      )
      const calculatedCrc32 = crc32(blockData) >>> 0
      if (calculatedCrc32 !== crc.crc32) {
        throw new CramMalformedError(
          `crc mismatch in block data: recorded CRC32 = ${crc.crc32}, but calculated CRC32 = ${calculatedCrc32}`,
        )
      }
    }

    block._endPosition = crc._endPosition
    block._size = block.compressedSize + sectionParsers.cramBlockCrc32.maxLength
  } else {
    block._endPosition = blockContentPosition + block.compressedSize
    block._size = block.compressedSize
  }

  return block
}
