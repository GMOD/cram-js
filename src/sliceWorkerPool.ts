/**
 * A pool of workers that decode whole slices.
 *
 * Shaped after `@gmod/bgzf-filehandle`'s bgzf pool, and pointed at a different
 * part of the problem. That one parallelises inflate, which is essentially all of
 * what reading BAM costs. Here decompression is only **24-35%** of a cold query —
 * the rest is the record decode — so a pool over decompression alone was measured
 * to cap out around 1.2x, and this one moves the whole slice instead:
 * decompression, the record decode, and mate association.
 *
 * What that needs, and why it was not possible before, is a decoded slice that
 * can cross a `postMessage`. See `cramFile/sliceTransfer.ts`.
 *
 * The width is there on the data that is slow. At jb2bench's own 19kb region a
 * query touches 16 slices on 1000x-coverage short reads and 22 on long reads;
 * only shallow files fall to one or two, and those are already fast. Even at one
 * slice the decode is off the main thread, which is the part a UI notices.
 */
import { deserializeSliceRecords } from './cramFile/sliceTransfer.ts'
import { CramMalformedError, CramUnimplementedError } from './errors.ts'

import type CramRecord from './cramFile/record.ts'
import type { SliceDecodeRequest } from './cramFile/slice/decodeSliceFromBytes.ts'
import type { SliceTransfer } from './cramFile/sliceTransfer.ts'

export interface CramSliceWorkerPool {
  /**
   * Decode one slice, returning its records **undecorated by the reference** —
   * the caller applies that, since `fetchReferenceSequence` cannot cross into a
   * worker.
   */
  decodeSlice(request: SliceDecodeRequest): Promise<CramRecord[]>
  destroy(): void
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'sliceResult'; requestId: number; payload: SliceTransfer }
  | { type: 'error'; requestId: number; name: string; message: string }

/**
 * Rebuild the error the worker threw.
 *
 * A malformed CRAM has to fail the same way whether or not a pool is in use,
 * and consumers do catch these by class — jbrowse distinguishes a malformed file
 * from a network fault — so the name is carried across and mapped back rather
 * than everything arriving as a bare `Error`.
 */
function reviveError(name: string, message: string) {
  if (name === 'CramMalformedError') {
    return new CramMalformedError(message)
  }
  if (name === 'CramUnimplementedError') {
    return new CramUnimplementedError(message)
  }
  const e = new Error(message)
  e.name = name
  return e
}

/**
 * Whether this context can host the pool at all.
 *
 * A Worker plus a Blob URL to launch it from — absent under node and vitest,
 * which is what makes {@link getSharedSliceWorkerPool} return undefined there so
 * callers fall through to the in-process decode. Note this deliberately does not
 * test for `SharedArrayBuffer`: nothing here needs cross-origin isolation,
 * because the payload is transferred rather than shared.
 */
function workersAvailable() {
  return (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
}

interface Pending {
  resolve: (records: CramRecord[]) => void
  reject: (err: Error) => void
}

class ManagedWorker {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextRequestId = 0
  private readyResolve?: () => void
  readyPromise: Promise<void>
  /** slices dispatched and not yet returned, for least-loaded scheduling */
  inFlight = 0

  constructor(workerUrl: string | URL) {
    this.worker = new Worker(workerUrl)
    this.readyPromise = new Promise<void>(resolve => {
      this.readyResolve = resolve
    })
    this.worker.onmessage = e => {
      this.handleMessage(e.data as WorkerMessage)
    }
    // A worker that dies outright (an OOM on a huge slice, say) reports no
    // requestId, so every slice waiting on it has to fail rather than hang.
    this.worker.onerror = () => {
      this.failAll(new Error('cram slice worker failed'))
    }
  }

  private handleMessage(msg: WorkerMessage) {
    if (msg.type === 'ready') {
      this.readyResolve?.()
      this.readyResolve = undefined
      return
    }
    const cb = this.pending.get(msg.requestId)
    if (!cb) {
      return
    }
    this.pending.delete(msg.requestId)
    this.inFlight--
    if (msg.type === 'sliceResult') {
      cb.resolve(deserializeSliceRecords(msg.payload))
    } else {
      cb.reject(reviveError(msg.name, msg.message))
    }
  }

  private failAll(err: Error) {
    for (const [id, cb] of this.pending) {
      this.pending.delete(id)
      cb.reject(err)
    }
    this.inFlight = 0
  }

  decodeSlice(request: SliceDecodeRequest) {
    const requestId = this.nextRequestId++
    const promise = new Promise<CramRecord[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
    })
    this.inFlight++
    // The slice bytes are transferred, not copied — but only after being sliced
    // out of the caller's buffer. `CramSlice.buildDecodeRequest` reads through
    // the file's range cache, so the buffer it hands back may be shared with
    // other readers; detaching it would corrupt them. One copy of the compressed
    // bytes, which is the smaller side of the operation.
    const bytes = request.sliceBytes.slice()
    const header = request.compressionHeaderContent.slice()
    this.worker.postMessage(
      {
        type: 'decodeSlice',
        requestId,
        request: {
          ...request,
          sliceBytes: bytes,
          compressionHeaderContent: header,
        },
      },
      [bytes.buffer, header.buffer],
    )
    return promise
  }

  init() {
    this.worker.postMessage({ type: 'init' })
  }

  terminate() {
    this.worker.terminate()
    this.failAll(new Error('cram slice worker pool destroyed'))
  }
}

let cachedBlobUrl: string | undefined

/**
 * The worker bundle, fetched only when a pool is actually started.
 *
 * **The dynamic import is about bundle weight, and only that.** The bundle is a
 * ~400 KB base64 string, and a static import pins it into the initial bundle of
 * every consumer that can reach `CramFile` — which is all of them, since
 * `file.ts` imports this module to start the pool. Measured with esbuild,
 * bundling and minifying `IndexedCramFile` + `CraiIndex`:
 *
 * ```
 * static    534 KB total, of which the worker string is 266 KB — half
 * dynamic   268 KB total, worker string deferred to a split chunk
 * ```
 *
 * So half the library's bundled weight came off every consumer, including one
 * that never enables the pool, and including one running under node where the
 * pool cannot start at all. It costs nothing to defer, because this function is
 * already only called from `createSliceWorkerPool`, which is async.
 *
 * This is the same trick, for the same reason, that jbrowse applies to
 * `@gmod/bgzf-filehandle`'s equivalent blob in `util/bgzfWorkerPool.ts` —
 * there it took an entry point from 54.7 KB to 114 B.
 */
async function getWorkerBlobUrl() {
  if (cachedBlobUrl === undefined) {
    const { default: workerSource } =
      await import('./wasm/cram-worker-source.js')
    cachedBlobUrl = URL.createObjectURL(
      new Blob([workerSource], { type: 'application/javascript' }),
    )
  }
  return cachedBlobUrl
}

let sharedPool: CramSliceWorkerPool | undefined
let sharedPoolPromise: Promise<CramSliceWorkerPool | undefined> | undefined
let poolGeneration = 0

/**
 * The process-wide pool, created on first use.
 *
 * Returns undefined where workers cannot be launched — node, vitest, a host with
 * no Blob URLs — so a caller can pass the result straight to the decode path and
 * get the in-process fallback.
 *
 * Shared rather than per file on purpose: a consumer opens one `IndexedCramFile`
 * per track, and a pool per track would put `4 x tracks` workers on the machine,
 * each with its own wasm instance.
 */
export function getSharedSliceWorkerPool(
  numWorkers?: number,
): Promise<CramSliceWorkerPool | undefined> {
  if (sharedPool) {
    return Promise.resolve(sharedPool)
  }
  if (!workersAvailable()) {
    return Promise.resolve(undefined)
  }
  if (!sharedPoolPromise) {
    const gen = poolGeneration
    const promise = createSliceWorkerPool(numWorkers).then(
      pool => {
        if (gen !== poolGeneration) {
          pool.destroy()
          throw new Error('worker pool was destroyed during initialization')
        }
        sharedPool = pool
        return pool
      },
      (error: unknown) => {
        // clear the cached rejected promise so a later call can retry
        if (sharedPoolPromise === promise) {
          sharedPoolPromise = undefined
        }
        throw error
      },
    )
    sharedPoolPromise = promise
  }
  return sharedPoolPromise
}

export function destroySharedSliceWorkerPool() {
  poolGeneration++
  sharedPool?.destroy()
  sharedPool = undefined
  sharedPoolPromise = undefined
}

export async function createSliceWorkerPool(
  numWorkers?: number,
  workerUrl?: string | URL,
): Promise<CramSliceWorkerPool> {
  if (!workersAvailable() && !workerUrl) {
    throw new Error(
      'cannot create a cram slice worker pool: this context has no Worker and Blob URL support',
    )
  }
  const url = workerUrl ?? (await getWorkerBlobUrl())
  const count = numWorkers ?? Math.min(navigator.hardwareConcurrency, 4)
  const workers: ManagedWorker[] = []
  for (let i = 0; i < count; i++) {
    workers.push(new ManagedWorker(url))
  }
  for (const w of workers) {
    w.init()
  }
  await Promise.all(workers.map(w => w.readyPromise))

  let destroyed = false
  return {
    decodeSlice(request) {
      if (destroyed) {
        return Promise.reject(
          new Error('cram slice worker pool has been destroyed'),
        )
      }
      // Least-loaded rather than round-robin. A query dispatches all its slices
      // at once and they are not the same size — a long-read slice can be
      // hundreds of times the work of a short-read one — so round-robin lands
      // several large slices on one worker while others idle.
      let chosen = workers[0]!
      for (const w of workers) {
        if (w.inFlight < chosen.inFlight) {
          chosen = w
        }
      }
      return chosen.decodeSlice(request)
    },
    destroy() {
      destroyed = true
      for (const w of workers) {
        w.terminate()
      }
      workers.length = 0
    },
  }
}
