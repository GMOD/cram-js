import { expect, test } from 'vitest'

import BetaCodec from '../src/cramFile/codecs/beta.ts'
import GammaCodec from '../src/cramFile/codecs/gamma.ts'
import HuffmanIntCodec from '../src/cramFile/codecs/huffman.ts'
import SubexpCodec from '../src/cramFile/codecs/subexp.ts'
import { CramBufferOverrunError } from '../src/index.ts'

import type { Cursors } from '../src/cramFile/codecs/_base.ts'
import type { CramFileBlock } from '../src/cramFile/file.ts'

// The bit-reading codecs read the core block by indexing it, and a read past the
// end is `undefined >> n`, which is 0 — so a truncated core block decodes as a
// run of zero bits and produces plausible numbers rather than reporting the
// truncation. Every one of the four needs its own guard, and each of them was
// missing one somewhere: the kind of asymmetry that only shows up on a file
// nobody has yet.
//
// The external-block equivalent is test/truncated.test.ts.

function harness(bytes: number[]) {
  const coreBlock = { content: Uint8Array.from(bytes) } as CramFileBlock
  const cursors: Cursors = {
    lastAlignmentStart: 0,
    coreBlock: { bitPosition: 7, bytePosition: 0 },
    externalBlocks: { getCursor: () => ({ bitPosition: 7, bytePosition: 0 }) },
  }
  return { coreBlock, cursors, blocks: {} }
}

test('beta reports a core block that runs out mid-value', () => {
  const { coreBlock, cursors, blocks } = harness([0xff])
  const codec = new BetaCodec({ offset: 0, length: 12 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('beta reads a value that does fit', () => {
  const { coreBlock, cursors, blocks } = harness([0xab, 0xcd])
  const codec = new BetaCodec({ offset: 0, length: 12 }, 'int')
  expect(codec.decode(coreBlock, blocks, cursors)).toBe(0xabc)
})

test('beta reports an empty core block on its byte-aligned fast path', () => {
  const { coreBlock, cursors, blocks } = harness([])
  const codec = new BetaCodec({ offset: 0, length: 8 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('subexp reports a core block of all-ones that never terminates', () => {
  // every bit set means the leading-ones count runs off the end of the block
  const { coreBlock, cursors, blocks } = harness([0xff, 0xff])
  const codec = new SubexpCodec({ offset: 0, K: 2 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('subexp reports a core block that ends before its value', () => {
  // 0b0111_1111: one leading zero, so K=6 bits of value follow and only 7 remain
  const { coreBlock, cursors, blocks } = harness([0x7f])
  const codec = new SubexpCodec({ offset: 0, K: 8 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('gamma reports a core block of all-zeros that never terminates', () => {
  const { coreBlock, cursors, blocks } = harness([0x00])
  const codec = new GammaCodec({ offset: 0 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('gamma reports a core block that ends on its terminating bit', () => {
  // 0b0000_0001: seven leading zeros, so length is 8 and seven value bits
  // follow — out of a block with nothing left. This decoded to 128.
  const { coreBlock, cursors, blocks } = harness([0x01])
  const codec = new GammaCodec({ offset: 0 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('gamma reads a value that does fit', () => {
  // 0b0100_0000: one leading zero, length 2, one value bit — both present
  const { coreBlock, cursors, blocks } = harness([0x40])
  const codec = new GammaCodec({ offset: 0 }, 'int')
  expect(codec.decode(coreBlock, blocks, cursors)).toBe(2)
})

// Huffman had no bounds check at all, and unlike the others it did not even
// fail loudly: the all-zeros code is a real entry in a canonical table — the
// shortest one, hence the most frequent symbol — so an exhausted core block
// decoded as that symbol for record after record, with the cursor never
// leaving the byte it was already past.
test('huffman reports an exhausted core block instead of returning a symbol', () => {
  const codec = new HuffmanIntCodec(
    { numCodes: 2, symbols: [42, 99], numLengths: 2, bitLengths: [1, 1] },
    'int',
  )
  const { coreBlock, cursors, blocks } = harness([])
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

test('huffman reads the symbols a core block does hold', () => {
  const codec = new HuffmanIntCodec(
    { numCodes: 2, symbols: [42, 99], numLengths: 2, bitLengths: [1, 1] },
    'int',
  )
  // 0b1000_0000: a 1 bit then seven 0 bits, so eight symbols and then the end
  const { coreBlock, cursors, blocks } = harness([0x80])
  expect(codec.decode(coreBlock, blocks, cursors)).toBe(99)
  for (let i = 0; i < 7; i++) {
    expect(codec.decode(coreBlock, blocks, cursors)).toBe(42)
  }
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})
