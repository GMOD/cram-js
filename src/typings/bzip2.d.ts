declare type BitReader = { __type: void }

declare const bzip2: {
  array: (buffer: Buffer) => BitReader
  header: (reader: BitReader) => number
  decompress: (reader: BitReader, size: number, length?: number) => -1 | string
}
