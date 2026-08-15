import { deflateSync } from 'zlib'

import { expect, test } from 'vitest'

import { zlib_uncompress } from '../src/htscodecs-wasm.ts'
import { CraiIndex, CramMalformedError, IndexedCramFile } from '../src/index.ts'

// Regression tests for the infinite loop in htscodecs-wasm/zlib_wrapper.c.
//
// The inflate loop grew the output buffer when `avail_out` hit 0 and otherwise
// looped again. A truncated deflate stream leaves output space free while
// `avail_in` is exhausted, so inflate returned Z_BUF_ERROR forever with nothing
// changing — a 100% CPU spin inside a synchronous wasm call, which no timeout
// or AbortSignal on the JS side can interrupt. Both tests below hung the
// process indefinitely before the fix, so a regression shows up as a timeout.

test('a truncated deflate stream fails instead of spinning', async () => {
  const full = deflateSync(Buffer.from('A'.repeat(5000)))
  await expect(zlib_uncompress(new Uint8Array(full))).resolves.toHaveLength(
    5000,
  )
  const truncated = new Uint8Array(full.subarray(0, -5))
  await expect(zlib_uncompress(truncated)).rejects.toThrow(
    'zlib_uncompress failed',
  )
  // and by class: a block that will not decode is a statement about the file,
  // the same one parseBlock makes when a decode comes out the wrong length
  await expect(zlib_uncompress(truncated)).rejects.toBeInstanceOf(
    CramMalformedError,
  )
}, 20000)

test('a truncated CRAM does not wedge later reads', async () => {
  // this fixture is a partial download — its last container runs off the end
  const truncated =
    'test/data/grc37-1#HG03297.mapped.ILLUMINA.bwa.ESN.low_coverage.20130415.bam.cram'

  function open(path: string) {
    return new IndexedCramFile({
      cramPath: path,
      index: new CraiIndex({ path: `${path}.crai` }),
      checkSequenceMD5: false,
    })
  }

  await expect(
    open(truncated).getRecordsForRange(0, 0, Number.POSITIVE_INFINITY),
  ).rejects.toThrow()

  // the failed decode above used to leave slice reads running that never
  // returned, monopolising the event loop for every later query in the process
  const records = await open('test/data/hard_clipping.cram').getRecordsForRange(
    0,
    0,
    Number.POSITIVE_INFINITY,
  )
  expect(records).toHaveLength(2)
}, 20000)
