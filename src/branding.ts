export type Brand<
  Base,
  Branding,
  ReservedName extends string = '__type__',
> = Base & { [K in ReservedName]: Branding } & { __witness__: Base }

function identity<TIn, TOut>() {
  return (item: TIn) => item as any as TOut
}

export type UInt8 = Brand<number, 'uint8'>
export const makeUInt8 = identity<number, UInt8>()

export function isUint8(n: number): n is UInt8 {
  if (!Number.isSafeInteger(n)) {
    return false
  }
  return n >= 0 && n <= 255
}

export function ensureUint8(n: number): UInt8 {
  if (!isUint8(n)) {
    throw new Error(n + ' is not uint8')
  }
  return n
}

export type Int8 = Brand<number, 'int8'>
export const assertInt8 = identity<number, Int8>()

export function isInt8(n: number): n is Int8 {
  if (!Number.isSafeInteger(n)) {
    return false
  }
  return n >= -128 && n <= 127
}

export function ensureInt8(n: number): Int8 {
  if (!isInt8(n)) {
    throw new Error(n + ' is not int8')
  }
  return n
}

export type Int32 = Brand<number, 'int32'>

export function assertInt32(n: number): Int32 {
  return n as Int32
}

const minInt32 = -2147483648
const maxInt32 = 2147483647

export function isInt32(n: number): n is Int32 {
  return Number.isSafeInteger(n) && n >= minInt32 && n <= maxInt32
}

export function ensureInt32(n: number): Int32 {
  if (!isInt32(n)) {
    throw new Error(n + ' is not int32')
  }
  return n
}

export type Int64 = Brand<bigint, 'int64'>

export function assertInt64(n: bigint): Int64 {
  return n as Int64
}

export function isInt64n(n: number): boolean {
  return Number.isSafeInteger(n)
}

const minInt64 = BigInt('-922372036854775808')
const maxInt64 = BigInt(' 9223372036854775807')

export function isInt64(n: bigint): n is Int64 {
  return n >= minInt64 && n <= maxInt64
}

export function ensureInt64(n: bigint): Int64 {
  if (!isInt64(n)) {
    throw new Error(n + ' is not int64')
  }
  return n
}

export function ensureInt64n(n: number): Int64 {
  if (!isInt64n(n)) {
    throw new Error(n + ' is not int64')
  }
  return assertInt64(BigInt(n))
}

export function addInt32(a: Int32, b: Int32) {
  return ensureInt32(a + b)
}

export function incrementInt32(a: Int32) {
  return addInt32(a, assertInt32(1))
}

export function decrementInt32(a: Int32) {
  return addInt32(a, assertInt32(-1))
}

export function subtractInt32(a: Int32, b: Int32) {
  return ensureInt32(a - b)
}
