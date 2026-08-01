import { deflateRawSync, deflateSync, gunzipSync, gzipSync } from 'zlib'

import { expect, test } from 'vitest'

import { unzip } from '../src/unzip.ts'

// Coverage for the libdeflate-based zlib_wrapper.c. libdeflate is a one-shot
// API with no streaming state, so the wrapper owns three things zlib used to
// do for it: format detection, walking concatenated gzip members, and sizing
// the output buffer.

const text = (n: number) => Buffer.from('the quick brown fox '.repeat(n))

test('decodes gzip, zlib and raw deflate', async () => {
  const input = text(100)
  for (const compressed of [
    gzipSync(input),
    deflateSync(input),
    deflateRawSync(input),
  ]) {
    const out = await unzip(new Uint8Array(compressed))
    expect(Buffer.from(out).equals(input)).toBe(true)
  }
})

// gzip members concatenate, and the old zlib loop stopped at the first
// Z_STREAM_END — it returned only the first member's bytes with no error.
// Nothing htslib writes as .crai is multi-member (it uses bgzf_open(fn,"wg"),
// a single gzip stream), but a hand-bgzipped index is, and silently returning
// a prefix of an index is the worst possible failure mode.
test('concatenated gzip members all decode', async () => {
  const members = ['first', 'second', 'third'].map(s => gzipSync(Buffer.from(s)))
  const out = await unzip(new Uint8Array(Buffer.concat(members)))
  expect(Buffer.from(out).toString()).toBe('firstsecondthird')
})

// BGZF is exactly that concatenation, one member per <=64KB of input, so a
// payload over 64KB spans several members. Checked against node's gunzip,
// which is multi-member aware.
test('a multi-member stream over 64KB matches node gunzip', async () => {
  const input = text(20_000) // 400KB, ~7 BGZF-sized members
  const members = []
  for (let pos = 0; pos < input.length; pos += 0xff00) {
    members.push(gzipSync(input.subarray(pos, pos + 0xff00)))
  }
  const compressed = Buffer.concat(members)
  expect(members.length).toBeGreaterThan(1)

  const out = await unzip(new Uint8Array(compressed))
  expect(out).toHaveLength(input.length)
  expect(Buffer.from(out).equals(gunzipSync(compressed))).toBe(true)
})

// BGZF files end with an empty EOF member, and some writers pad with zeros
// past it. Neither is an error.
test('tolerates an empty trailing member and zero padding', async () => {
  const body = gzipSync(text(10))
  const eof = gzipSync(Buffer.alloc(0))
  const padded = Buffer.concat([body, eof, Buffer.alloc(64)])
  const out = await unzip(new Uint8Array(padded))
  expect(Buffer.from(out).equals(text(10))).toBe(true)
})

// With no expected size the wrapper starts at 4x the input and doubles on
// LIBDEFLATE_INSUFFICIENT_SPACE. Zeros compress ~1000:1, so this forces
// several rounds of growth — the path a large .crai takes.
test('grows the output buffer when the size is unknown', async () => {
  const input = Buffer.alloc(5 * 1024 * 1024)
  const compressed = gzipSync(input)
  expect(input.length).toBeGreaterThan(compressed.length * 4)

  const out = await unzip(new Uint8Array(compressed))
  expect(out).toHaveLength(input.length)
  expect(out.every(b => b === 0)).toBe(true)
})

test('an exact expected size decodes in one allocation', async () => {
  const input = text(5000)
  const out = await unzip(new Uint8Array(gzipSync(input)), input.length)
  expect(Buffer.from(out).equals(input)).toBe(true)
})

// A wrong expected size must not truncate — the caller's own length assertion
// is what reports the mismatch, so the wrapper has to return the real bytes.
test('an undersized expected size still decodes fully', async () => {
  const input = text(5000)
  const out = await unzip(new Uint8Array(gzipSync(input)), 10)
  expect(out).toHaveLength(input.length)
})

// expected_size is an ITF8 read straight off the wire, so a corrupt block
// header can claim any size at all. The wrapper caps what it will believe at
// deflate's 1032:1 maximum expansion rather than mallocing 2GB on its word.
test('an absurd expected size is not trusted as an allocation size', async () => {
  const input = text(10)
  const out = await unzip(new Uint8Array(gzipSync(input)), 0x7fffffff)
  expect(Buffer.from(out).equals(input)).toBe(true)
})

test('rejects corrupt input rather than returning a prefix', async () => {
  const compressed = gzipSync(text(100))
  compressed[compressed.length - 5] ^= 0xff // corrupt the CRC
  await expect(unzip(new Uint8Array(compressed))).rejects.toThrow(
    'zlib_uncompress failed',
  )
})
