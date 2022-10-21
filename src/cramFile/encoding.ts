export type NullEncoding = {
  codecId: 0
  parametersBytes: number
  parameters: Record<string, never>
}

export type ExternalCramEncoding = {
  codecId: 1
  parametersBytes: number
  parameters: {
    blockContentId: number
  }
}

export type GolombEncoding = {
  codecId: 2
  parametersBytes: number
  parameters: {
    offset: number
    M: number
  }
}

export type HuffmanEncoding = {
  codecId: 3
  parametersBytes: number
  parameters: {
    numCodes: number
    symbols: number[]
    numLengths: number
    bitLengths: number[]
  }
}

export type ByteArrayLengthEncoding = {
  codecId: 4
  parametersBytes: number
  parameters: {
    lengthsEncoding: CramEncoding
    valuesEncoding: CramEncoding
  }
}

export type ByteArrayStopCramEncoding = {
  codecId: 5
  parametersBytes: number
  parameters: {
    stopByte: number
    blockContentId: number
  }
}

export type BetaEncoding = {
  codecId: 6
  parametersBytes: number
  parameters: {
    offset: number
    length: number // int number of bits
  }
}

export type SubexpEncoding = {
  codecId: 7
  parametersBytes: number
  parameters: {
    offset: number
    K: number
  }
}

export type GolombRiceEncoding = {
  codecId: 8
  parametersBytes: number
  parameters: {
    offset: number
    log2m: number
  }
}

export type GammaEncoding = {
  codecId: 9
  parametersBytes: number
  parameters: {
    offset: number
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
