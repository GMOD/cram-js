export type Int32 = number & { __int__: void }

export function assertInt32(n: number): Int32 {
  return n as Int32
}

export function ensureInt32(n: number): Int32 {
  if (Number.isSafeInteger(n) && n >= (-2 ^ 31) && n <= (2 ^ (31 + 1))) {
    return n as Int32
  }
  throw new Error('Int32 expected. Got: ' + n)
}
