import crc32 from 'crc/calculators/crc32'
import { BlobFile, LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import { CramFile, CramMalformedError } from '../src/index.ts'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
} from 'generic-filehandle2'

// Every read the container header issues. Over HTTP each one is a range
// request, so the count is the thing under test.
class CountingFile implements GenericFilehandle {
  reads: { position: number; length: number }[] = []
  private inner: GenericFilehandle

  constructor(inner: GenericFilehandle) {
    this.inner = inner
  }

  async read(length: number, position = 0) {
    const data = await this.inner.read(length, position)
    this.reads.push({ position, length: data.length })
    return data
  }

  readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  readFile(options?: BufferEncoding | FilehandleOptions) {
    return typeof options === 'string'
      ? this.inner.readFile(options)
      : options?.encoding === undefined
        ? this.inner.readFile(options)
        : this.inner.readFile({ ...options, encoding: options.encoding })
  }

  stat() {
    return this.inner.stat()
  }

  close() {
    return this.inner.close()
  }
}

function itf8(value: number) {
  return value < 0x80
    ? [value]
    : value < 0x4000
      ? [0x80 | (value >> 8), value & 0xff]
      : (() => {
          throw new Error(`itf8 ${value} not supported by this test`)
        })()
}

// A CRAM 3.0 file that is a definition and one container header, with as many
// landmarks as asked for, followed by `trailing` bytes of nothing.
function syntheticFile(landmarks: number[], trailing: number, crc = true) {
  const definition = Array.from('CRAM', c => c.charCodeAt(0))
  definition.push(3, 0, ...new Array<number>(20).fill(0))
  const header = [
    ...[0x10, 0x27, 0, 0], // length 10000, i32 little-endian
    ...itf8(0), // refSeqId
    ...itf8(1), // refSeqStart
    ...itf8(5000), // alignmentSpan
    ...itf8(100), // numRecords
    ...itf8(0), // recordCounter (ltf8, one byte at 0)
    ...itf8(0), // numBases (ltf8)
    ...itf8(landmarks.length + 1), // numBlocks
    ...itf8(landmarks.length),
    ...landmarks.flatMap(l => itf8(l)),
  ]
  const recorded = crc ? crc32(new Uint8Array(header)) >>> 0 : 0
  header.push(
    recorded & 0xff,
    (recorded >> 8) & 0xff,
    (recorded >> 16) & 0xff,
    (recorded >>> 24) & 0xff,
  )
  const bytes = new Uint8Array([
    ...definition,
    ...header,
    ...new Array<number>(trailing).fill(0),
  ])
  return { file: new BlobFile(new Blob([bytes])), headerSize: header.length }
}

function open(filehandle: GenericFilehandle, validateChecksums = false) {
  const file = new CountingFile(filehandle)
  return { file, cram: new CramFile({ filehandle: file, validateChecksums }) }
}

test('a container header is one read', async () => {
  const { file, cram } = open(new LocalFile('test/data/ce#1000.tmp.cram'))
  await cram.getDefinition()
  file.reads = []

  const header = await cram.getContainerAtPosition(26).getHeader()
  expect(header.numLandmarks).toBeGreaterThan(0)
  expect(header.landmarks).toHaveLength(header.numLandmarks)
  expect(file.reads).toHaveLength(1)
})

test('the EOF container parses from a read that runs off the end of the file', async () => {
  const { file, cram } = open(new LocalFile('test/data/ce#1000.tmp.cram'))
  const { size } = await file.stat()
  await cram.getDefinition()
  file.reads = []

  // a CRAM 3 EOF container is the last 38 bytes of the file
  const header = await cram.getContainerAtPosition(size - 38).getHeader()
  expect(header.numRecords).toBe(0)
  expect(header.landmarks).toEqual([])
  expect(header._endPosition).toBe(size - 38 + 38 - 15)
  expect(file.reads).toHaveLength(1)
  expect(file.reads[0]!.length).toBe(38)
})

test('a short landmark list parses out of the speculative read', async () => {
  const landmarks = [200, 1500, 3000]
  const { file: blob, headerSize } = syntheticFile(landmarks, 10000)
  const { file, cram } = open(blob)
  await cram.getDefinition()
  file.reads = []

  const header = await cram.getContainerAtPosition(26).getHeader()
  expect(header.landmarks).toEqual(landmarks)
  expect(header._size).toBe(headerSize)
  expect(file.reads).toHaveLength(1)
})

test('a landmark list the speculative read cannot hold costs one more read', async () => {
  const landmarks = Array.from({ length: 64 }, (_, i) => 200 + i * 150)
  const { file: blob, headerSize } = syntheticFile(landmarks, 10000)
  const { file, cram } = open(blob)
  await cram.getDefinition()
  file.reads = []

  const header = await cram.getContainerAtPosition(26).getHeader()
  expect(header.numLandmarks).toBe(64)
  expect(header.landmarks).toEqual(landmarks)
  expect(header._size).toBe(headerSize)
  expect(header._endPosition).toBe(26 + headerSize)
  expect(file.reads).toHaveLength(2)
})

test('the CRC is checked on both paths, without another read', async () => {
  for (const count of [3, 64]) {
    const landmarks = Array.from({ length: count }, (_, i) => 200 + i * 150)
    const good = open(syntheticFile(landmarks, 10000).file, true)
    await good.cram.getDefinition()
    good.file.reads = []
    const header = await good.cram.getContainerAtPosition(26).getHeader()
    expect(header.landmarks).toEqual(landmarks)
    expect(good.file.reads).toHaveLength(count === 3 ? 1 : 2)

    const bad = open(syntheticFile(landmarks, 10000, false).file, true)
    await expect(
      bad.cram.getContainerAtPosition(26).getHeader(),
    ).rejects.toThrow(CramMalformedError)
  }
})
