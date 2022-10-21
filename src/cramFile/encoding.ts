import { Int32, Int8 } from '../branding'

export type NullEncoding = {
  codecId: 0
  parametersBytes: Int32
  parameters: Record<string, never>
}

export type ExternalCramEncoding = {
  codecId: 1
  parametersBytes: Int32
  parameters: {
    blockContentId: Int32
  }
}

export type GolombEncoding = {
  codecId: 2
  parametersBytes: Int32
  parameters: {
    offset: Int32
    M: Int32
  }
}

export type HuffmanEncoding = {
  codecId: 3
  parametersBytes: Int32
  parameters: {
    numCodes: Int32
    symbols: Int32[]
    numLengths: Int32
    bitLengths: Int32[]
  }
}

export type ByteArrayLengthEncoding = {
  codecId: 4
  parametersBytes: Int32
  parameters: {
    lengthsEncoding: CramEncoding
    valuesEncoding: CramEncoding
  }
}

export type ByteArrayStopCramEncoding = {
  codecId: 5
  parametersBytes: Int32
  parameters: {
    stopByte: Int8
    blockContentId: Int32
  }
}

export type BetaEncoding = {
  codecId: 6
  parametersBytes: Int32
  parameters: {
    offset: Int32
    length: Int32 // int number of bits
  }
}

export type SubexpEncoding = {
  codecId: 7
  parametersBytes: Int32
  parameters: {
    offset: Int32
    K: Int32
  }
}

export type GolombRiceEncoding = {
  codecId: 8
  parametersBytes: Int32
  parameters: {
    offset: number
    log2m: number
  }
}

export type GammaEncoding = {
  codecId: 9
  parametersBytes: Int32
  parameters: {
    offset: Int32
  }
}

export type CramEncoding =
  | NullEncoding
  | ExternalCramEncoding
  | GolombEncoding
  | HuffmanEncoding
  | ByteArrayLengthEncoding
  | ByteArrayStopCramEncoding
  | BetaEncoding
  | SubexpEncoding
  | GolombRiceEncoding
  | GammaEncoding
