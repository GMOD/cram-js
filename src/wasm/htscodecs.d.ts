interface HtsCodecsModule {
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  _rans_uncompress: (
    inPtr: number,
    inSize: number,
    outSizePtr: number,
  ) => number
  _rans_uncompress_4x16: (
    inPtr: number,
    inSize: number,
    outSizePtr: number,
  ) => number
  _arith_uncompress: (
    inPtr: number,
    inSize: number,
    outSizePtr: number,
  ) => number
  _fqz_decompress: (
    inPtr: number,
    inSize: number,
    outSizePtr: number,
    lenPtr: number,
  ) => number
  _tok3_decode_names: (
    inPtr: number,
    inSize: number,
    outSizePtr: number,
  ) => number
  _bz2_uncompress: (
    inPtr: number,
    inSize: number,
    expectedSize: number,
    outSizePtr: number,
  ) => number
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
  ) => unknown
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown
  getValue: (ptr: number, type: string) => number
  setValue: (ptr: number, value: number, type: string) => void
  HEAPU8: Uint8Array
  HEAP32: Int32Array
}

export default function createHtsCodecsModule(): Promise<HtsCodecsModule>
