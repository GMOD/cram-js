import { expect, test, vi } from 'vitest'

import { xzDecompress } from '../src/xz-decompress/xz-decompress.ts'

// `printf 'hello cram lzma test\n' | xz -c`, as hex — a whole xz stream in 58
// bytes, so the lzma path is exercised without a binary fixture. The CRAM lzma
// blocks in compressions.test.ts cover the format in context; what needs a
// stream of its own here is the module instantiation around it.
const XZ_HELLO =
  'fd377a585a000004e6d6b44604c0191521011600000000000000000009e390b5' +
  '01001468656c6c6f206372616d206c7a6d6120746573740a000000009273406c' +
  '4068f8b10001351576936aef1fb6f37d010000000004595a'
const stream = Uint8Array.from(
  XZ_HELLO.match(/../g)!.map(h => Number.parseInt(h, 16)),
)
const text = 'hello cram lzma test\n'

// This one runs first on purpose: the module is instantiated once per process,
// so a successful decode above it would leave nothing for the failure to happen
// to. Before this, the instantiation promise was cached whatever it settled to —
// one transient failure and every lzma block for the life of the process failed
// with the same error, never retrying.
test('a failed instantiation is not cached, so the next call retries', async () => {
  const instantiate = vi
    .spyOn(WebAssembly, 'instantiate')
    .mockRejectedValueOnce(new Error('instantiation refused'))

  await expect(xzDecompress(stream)).rejects.toThrow('instantiation refused')
  instantiate.mockRestore()

  expect(new TextDecoder().decode(await xzDecompress(stream))).toBe(text)
})

test('decompresses an xz stream', async () => {
  expect(new TextDecoder().decode(await xzDecompress(stream))).toBe(text)
})
