import { expect, test } from 'vitest'

import ExternalCodec, {
  batchDecodeItf8,
} from '../src/cramFile/codecs/external.ts'
import { CramBufferOverrunError } from '../src/errors.ts'

import type { Cursors } from '../src/cramFile/codecs/_base.ts'
import type { CramFileBlock } from '../src/cramFile/file.ts'

// Regression test for the latent bug fixed in slice/index.ts (commit
// alongside this test): the inlined-bind fast path for ExternalCodec byte
// reads omitted the bounds check that ExternalCodec.decode performs. A
// truncated/corrupt external block would silently yield `undefined` for
// byte reads — downstream `bd.XX()!` lied about that being defined,
// propagating NaN/0 through the rest of the slice decode rather than
// surfacing the truncation. The bind path mirrors codec.decode
// line-for-line as a perf optimization, so codec parity here is the
// invariant the fast path has to preserve.
test('ExternalCodec byte path throws CramBufferOverrunError past EOF', () => {
  const content = new Uint8Array([0x41, 0x42])
  const block = {
    content,
    contentId: 1,
  } as unknown as CramFileBlock
  const blocksByContentId = { 1: block }

  const cursor = { bitPosition: 7 as const, bytePosition: 0 }
  const cursors: Cursors = {
    lastAlignmentStart: 0,
    coreBlock: { bitPosition: 7, bytePosition: 0 },
    externalBlocks: {
      map: new Map([[1, cursor]]),
      getCursor: () => cursor,
    },
  }

  const codec = new ExternalCodec({ blockContentId: 1 }, 'byte')

  expect(codec.decode(null as never, blocksByContentId, cursors)).toBe(0x41)
  expect(codec.decode(null as never, blocksByContentId, cursors)).toBe(0x42)
  expect(() => codec.decode(null as never, blocksByContentId, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

// Same invariant for the pre-decoded int path. Int external blocks are
// batch-ITF8-decoded up front into an Int32Array, and both ExternalCodec.decode
// and the inlined-bind fast path read from it by advancing a shared index. An
// exhausted array yields `undefined`, which used to be asserted away with `!`
// and then propagated as NaN through start/readLength — silent data
// corruption instead of a truncation error.
test('ExternalCodec pre-decoded int path throws CramBufferOverrunError past EOF', () => {
  const block = {
    content: new Uint8Array([1, 2]),
    contentId: 1,
  } as unknown as CramFileBlock
  const blocksByContentId = { 1: block }

  const cursor = { bitPosition: 7 as const, bytePosition: 0 }
  const cursors: Cursors = {
    lastAlignmentStart: 0,
    coreBlock: { bitPosition: 7, bytePosition: 0 },
    externalBlocks: {
      getCursor: () => cursor,
    },
    preDecodedIntBlocks: new Map([
      [1, { values: batchDecodeItf8(new Uint8Array([1, 2])), index: 0 }],
    ]),
  }

  const codec = new ExternalCodec({ blockContentId: 1 }, 'int')

  expect(codec.decode(null as never, blocksByContentId, cursors)).toBe(1)
  expect(codec.decode(null as never, blocksByContentId, cursors)).toBe(2)
  expect(() => codec.decode(null as never, blocksByContentId, cursors)).toThrow(
    CramBufferOverrunError,
  )
})

// batchDecodeItf8 sizes its scratch Int32Array by the input byte count, which
// over-allocates whenever values are multi-byte. Returning a subarray of that
// scratch would pin the whole thing for as long as the slice stays cached, so
// it copies out past a threshold — either way the decoded values, and the
// length, must be identical.
test('batchDecodeItf8 decodes multi-byte ITF8 values without retaining slack', () => {
  // 0x7f -> 1 byte; 0x80 0x80 -> 2 bytes (128); 0xc1 0x00 0x00 -> 3 bytes
  const buffer = new Uint8Array([0x7f, 0x80, 0x80, 0xc1, 0x00, 0x00])
  const values = batchDecodeItf8(buffer)
  expect([...values]).toEqual([0x7f, 128, 0x10000])
  // the returned view must not expose the scratch array's slack
  expect(values.length).toBe(3)
})
