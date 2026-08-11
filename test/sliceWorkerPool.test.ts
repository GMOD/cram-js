// The pool's own logic — the message protocol, error revival, least-loaded
// dispatch — runs in no other test: node has no `Worker`, so every other test
// takes the in-process fallback and this file would otherwise ship unexecuted.
//
// So a stub Worker stands in for a real one and runs `decodeSliceFromBytes`
// inline. That exercises everything on the host side of the boundary, which is
// where the logic is; what it cannot cover is a genuine thread and a genuine
// structured-clone, so the payload is passed through `structuredClone` to keep
// the "is this actually transferable" question honest.
import { LocalFile } from 'generic-filehandle2'
import { afterEach, expect, test, vi } from 'vitest'

import CraiIndex from '../src/craiIndex.ts'
import CramFile from '../src/cramFile/index.ts'
import { decodeSliceFromBytes } from '../src/cramFile/slice/decodeSliceFromBytes.ts'
import { CramMalformedError } from '../src/errors.ts'
import { IndexedCramFile } from '../src/index.ts'
import { createSliceWorkerPool } from '../src/sliceWorkerPool.ts'

import type { SliceDecodeRequest } from '../src/cramFile/slice/decodeSliceFromBytes.ts'

const seqFetch = async (_id: number, start: number, end: number) =>
  'A'.repeat(end - start)

const PATH = 'test/data/SRR396637.sorted.clip.cram'

/** How the stub should behave, so one harness covers success and failure. */
type Mode = 'decode' | 'throwMalformed' | 'die'

/** what the pool posts to a worker */
type HostMessage =
  | { type: 'init' }
  | { type: 'decodeSlice'; requestId: number; request: SliceDecodeRequest }

function installStubWorker(mode: Mode, seen: SliceDecodeRequest[]) {
  class StubWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    terminated = false

    postMessage(msg: HostMessage) {
      void this.handle(msg)
    }

    private async handle(msg: HostMessage) {
      if (msg.type === 'init') {
        this.onmessage?.({ data: { type: 'ready' } })
        return
      }
      const { requestId, request } = msg
      seen.push(request)
      if (mode === 'die') {
        this.onerror?.()
        return
      }
      if (mode === 'throwMalformed') {
        this.onmessage?.({
          data: {
            type: 'error',
            requestId,
            name: 'CramMalformedError',
            message: 'stub says this file is malformed',
          },
        })
        return
      }
      const { payload } = await decodeSliceFromBytes(request)
      // through structuredClone, so anything not actually clonable fails here
      this.onmessage?.({
        data: {
          type: 'sliceResult',
          requestId,
          payload: structuredClone(payload),
        },
      })
    }

    terminate() {
      this.terminated = true
    }
  }
  vi.stubGlobal('Worker', StubWorker)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function firstRequest(): Promise<SliceDecodeRequest> {
  const indexed = new IndexedCramFile({
    cramFilehandle: new LocalFile(PATH),
    index: new CraiIndex({ filehandle: new LocalFile(`${PATH}.crai`) }),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
  const index = (
    indexed as unknown as {
      index: {
        getEntriesForRange: (
          s: number,
          a: number,
          b: number,
        ) => Promise<
          { containerStart: number; sliceStart: number; sliceBytes: number }[]
        >
      }
    }
  ).index
  const entries = await index.getEntriesForRange(0, 0, 100_000_000)
  const file = new CramFile({
    filehandle: new LocalFile(PATH),
    fetchReferenceSequence: seqFetch,
    checkSequenceMD5: false,
  })
  const slice = file
    .getContainerAtPosition(entries[0]!.containerStart)
    .getSlice(entries[0]!.sliceStart, entries[0]!.sliceBytes)
  const req = await slice.buildDecodeRequest({ decodeTags: true })
  expect(req).toBeDefined()
  return req!
}

test('a slice decoded through the pool matches one decoded in-process', async () => {
  const seen: SliceDecodeRequest[] = []
  installStubWorker('decode', seen)
  const pool = await createSliceWorkerPool(2, 'stub://worker')

  const viaPool = await pool.decodeSlice(await firstRequest())
  const { payload } = await decodeSliceFromBytes(await firstRequest())
  const { deserializeSliceRecords } =
    await import('../src/cramFile/sliceTransfer.ts')
  const direct = deserializeSliceRecords(payload)

  expect(viaPool.length).toBe(direct.length)
  expect(viaPool.map(r => r.toJSON())).toEqual(direct.map(r => r.toJSON()))
  expect(viaPool[0]!.tags).toEqual(direct[0]!.tags)
  pool.destroy()
})

test('the request is transferred with copies, leaving the caller buffers intact', async () => {
  const seen: SliceDecodeRequest[] = []
  installStubWorker('decode', seen)
  const pool = await createSliceWorkerPool(1, 'stub://worker')

  const req = await firstRequest()
  const originalLength = req.sliceBytes.length
  await pool.decodeSlice(req)

  // The pool copies before transferring on purpose: buildDecodeRequest reads
  // through the file's range cache, so detaching that buffer would corrupt other
  // readers of the same range. If it ever stops copying, this length goes to 0.
  expect(req.sliceBytes.length).toBe(originalLength)
  expect(seen[0]!.sliceBytes).not.toBe(req.sliceBytes)
  pool.destroy()
})

test('a decode error keeps its class across the boundary', async () => {
  installStubWorker('throwMalformed', [])
  const pool = await createSliceWorkerPool(1, 'stub://worker')
  await expect(pool.decodeSlice(await firstRequest())).rejects.toThrow(
    CramMalformedError,
  )
  pool.destroy()
})

test('a worker that dies rejects its slice rather than hanging', async () => {
  installStubWorker('die', [])
  const pool = await createSliceWorkerPool(1, 'stub://worker')
  await expect(pool.decodeSlice(await firstRequest())).rejects.toThrow(
    /worker failed/,
  )
  pool.destroy()
})

test('destroy rejects work still in flight', async () => {
  installStubWorker('decode', [])
  const pool = await createSliceWorkerPool(1, 'stub://worker')
  const req = await firstRequest()
  const inFlight = pool.decodeSlice(req)
  pool.destroy()
  await expect(inFlight).rejects.toThrow(/destroyed/)
  await expect(pool.decodeSlice(req)).rejects.toThrow(/destroyed/)
})

test('slices spread across workers rather than piling on one', async () => {
  const seen: SliceDecodeRequest[] = []
  // count dispatches per worker instance by tagging each stub
  const perWorker: number[] = []
  class CountingWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    private id = perWorker.push(0) - 1
    postMessage(msg: HostMessage) {
      void this.handle(msg)
    }
    private async handle(msg: HostMessage) {
      if (msg.type === 'init') {
        this.onmessage?.({ data: { type: 'ready' } })
        return
      }
      perWorker[this.id]!++
      seen.push(msg.request)
      const { payload } = await decodeSliceFromBytes(msg.request)
      this.onmessage?.({
        data: { type: 'sliceResult', requestId: msg.requestId, payload },
      })
    }
    terminate() {
      // nothing to release; the counts are what this stub is for
    }
  }
  vi.stubGlobal('Worker', CountingWorker)

  const pool = await createSliceWorkerPool(4, 'stub://worker')
  const req = await firstRequest()
  // dispatched together, as a query does, so least-loaded has something to do
  await Promise.all([
    pool.decodeSlice(req),
    pool.decodeSlice(req),
    pool.decodeSlice(req),
    pool.decodeSlice(req),
  ])
  expect(perWorker.filter(n => n > 0).length).toBeGreaterThan(1)
  pool.destroy()
})
