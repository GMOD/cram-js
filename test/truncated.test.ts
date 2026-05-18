import { expect, test } from 'vitest'

import ExternalCodec from '../src/cramFile/codecs/external.ts'
import { CramBufferOverrunError } from '../src/cramFile/codecs/getBits.ts'

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

  expect(
    codec.decode(null as never, null as never, blocksByContentId, cursors),
  ).toBe(0x41)
  expect(
    codec.decode(null as never, null as never, blocksByContentId, cursors),
  ).toBe(0x42)
  expect(() =>
    codec.decode(null as never, null as never, blocksByContentId, cursors),
  ).toThrow(CramBufferOverrunError)
})
