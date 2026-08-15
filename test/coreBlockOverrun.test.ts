import { expect, test } from 'vitest'

import BetaCodec from '../src/cramFile/codecs/beta.ts'
import GammaCodec from '../src/cramFile/codecs/gamma.ts'
import SubexpCodec from '../src/cramFile/codecs/subexp.ts'
import { CramBufferOverrunError } from '../src/index.ts'

import type { Cursors } from '../src/cramFile/codecs/_base.ts'
import type { CramFileBlock } from '../src/cramFile/file.ts'

// The bit-reading codecs read the core block by indexing it, and a read past the
// end is `undefined >> n`, which is 0 — so a truncated core block decoded as a
// run of zero bits and produced plausible numbers rather than reporting the
// truncation. `gamma` guarded against that; `beta` and `subexp` did not, which
// is the kind of asymmetry that only shows up on a file nobody has yet.
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

test('gamma still reports one, as it always has', () => {
  const { coreBlock, cursors, blocks } = harness([0x00])
  const codec = new GammaCodec({ offset: 0 }, 'int')
  expect(() => codec.decode(coreBlock, blocks, cursors)).toThrow(
    CramBufferOverrunError,
  )
})
