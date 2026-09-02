/**
 * The slice-decode worker's entry point.
 *
 * Deliberately thin: it owns the message protocol and nothing else, because
 * everything it does is testable without a worker through
 * {@link decodeSliceFromBytes}, and anything that lived here would not be.
 *
 * Bundled by `webpack.worker.config.js` and then wrapped as a string module by
 * `scripts/inline-worker.sh`, so the pool can launch it from a Blob URL with no
 * consumer wiring. See `docs/workers.md`.
 */
import { serializeSlice } from '../cramFile/decodedSlice.ts'
import { decodeSliceFromBytes } from '../cramFile/slice/decodeSliceFromBytes.ts'
import { warmupWasm } from '../htscodecs-wasm.ts'

import type { SliceDecodeRequest } from '../cramFile/slice/decodeSliceFromBytes.ts'

type HostMessage =
  | { type: 'init' }
  | { type: 'decodeSlice'; requestId: number; request: SliceDecodeRequest }

declare const self: {
  onmessage: ((e: { data: HostMessage }) => void) | null
  postMessage: (message: unknown, transfer?: ArrayBuffer[]) => void
}

async function handle(msg: HostMessage) {
  if (msg.type === 'init') {
    try {
      // instantiate the wasm before any slice arrives, so the first dispatch is
      // not the slow one — see warmupWasm
      await warmupWasm()
    } catch (e) {
      // Reported rather than left to reject unhandled. A worker whose wasm will
      // not instantiate can only fail every slice it is given, and the host
      // turns an init failure into the in-process fallback — where the same
      // module has its own chance to load. Silence here instead costs the
      // host's whole startup timeout before it concludes the same thing.
      self.postMessage({ type: 'initError', message: String(e) })
      return
    }
    self.postMessage({ type: 'ready' })
    return
  }

  const { requestId } = msg
  try {
    const { payload, transfer } = serializeSlice(
      await decodeSliceFromBytes(msg.request),
    )
    self.postMessage({ type: 'sliceResult', requestId, payload }, transfer)
  } catch (e) {
    // Error objects do not survive postMessage with their class intact, so the
    // name is sent alongside the message and the host rebuilds the right error.
    // A malformed CRAM must fail the same way whether or not a pool is in use.
    const err = e as { name?: string; message?: string }
    self.postMessage({
      type: 'error',
      requestId,
      name: err.name ?? 'Error',
      message: err.message ?? String(e),
    })
  }
}

self.onmessage = e => {
  void handle(e.data)
}
