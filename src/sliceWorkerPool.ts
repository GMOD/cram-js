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
 * What that needs is a decoded slice that can cross a `postMessage` as it is,
 * which is what `cramFile/decodedSlice.ts` is.
 *
 * The width is there on the data that is slow. At jb2bench's own 19kb region a
 * query touches 16 slices on 1000x-coverage short reads and 22 on long reads;
 * only shallow files fall to one or two, and those are already fast. Even at one
 * slice the decode is off the main thread, which is the part a UI notices.
 */
import { deserializeSlice } from './cramFile/decodedSlice.ts'
import { CramMalformedError, CramUnimplementedError } from './errors.ts'

import type DecodedSlice from './cramFile/decodedSlice.ts'
import type { SliceTransfer } from './cramFile/decodedSlice.ts'
import type { SliceDecodeRequest } from './cramFile/slice/decodeSliceFromBytes.ts'

export interface CramSliceWorkerPool {
  /**
   * Decode one slice, returning it **undecorated by the reference** — the
   * caller applies that, since `fetchReferenceSequence` cannot cross into a
   * worker.
   *
   * Resolves **undefined** when the pool could not take the slice, or lost it:
   * a worker that died carrying it, a pool destroyed under it, or one whose
   * workers have all failed. None of those say anything about the file, so the
   * caller decodes in-process — the `undefined`-means-decode-it-yourself
   * contract `_fetchRecordsInWorker` also uses for "no pool available". An error
   * the worker *reported* rejects instead, with its class intact, so a malformed
   * CRAM fails the same way with or without a pool.
   */
  decodeSlice(request: SliceDecodeRequest): Promise<DecodedSlice | undefined>
  destroy(): void
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'initError'; message: string }
  | { type: 'sliceResult'; requestId: number; payload: SliceTransfer }
  | { type: 'error'; requestId: number; name: string; message: string }

/**
 * Rebuild the error the worker threw.
 *
 * A malformed CRAM has to fail the same way whether or not a pool is in use, so
 * the name is carried across and mapped back rather than everything arriving as
 * a bare `Error`. Worth doing because the classes are exported: a consumer can
 * catch by class either side of the boundary.
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
  /** undefined means "not decoded here" — see {@link CramSliceWorkerPool} */
  resolve: (slice: DecodedSlice | undefined) => void
  reject: (err: Error) => void
}

/**
 * How long a worker gets to answer the init handshake before the pool gives up
 * on it and the caller decodes in-process.
 *
 * Not a performance budget — the handshake is a `postMessage` round trip plus
 * `warmupWasm`, milliseconds — but the backstop for a worker that never answers
 * and reports no error either, as when a host blocks the Blob URL or an
 * extension intercepts the script. The pool is awaited before the decode and
 * nothing further up times it out, so without this those hang every read.
 */
const WORKER_STARTUP_TIMEOUT_MS = 30_000

class ManagedWorker {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextRequestId = 0
  private readyResolve?: () => void
  private readyReject?: (err: Error) => void
  private startupTimer?: ReturnType<typeof setTimeout>
  readyPromise: Promise<void>
  /** slices dispatched and not yet returned, for least-loaded scheduling */
  inFlight = 0
  /**
   * Set once this worker has failed or been terminated. The scheduler skips it
   * from then on — without this a dead worker looks like the *best* candidate,
   * since failing its slices resets `inFlight` to 0 and least-loaded then sends
   * it everything.
   */
  failed = false

  constructor(workerUrl: string | URL) {
    this.worker = new Worker(workerUrl)
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    // Rejecting `readyPromise` is what this timer is for; see the constant.
    this.startupTimer = setTimeout(() => {
      this.fail(
        new Error(
          `cram slice worker did not start within ${WORKER_STARTUP_TIMEOUT_MS}ms`,
        ),
      )
    }, WORKER_STARTUP_TIMEOUT_MS)
    this.worker.onmessage = e => {
      this.handleMessage(e.data as WorkerMessage)
    }
    // A worker that dies outright reports no requestId, so every slice waiting
    // on it has to be released rather than left hanging. Two cases reach here:
    // a death mid-decode (an OOM on a huge slice, say), and a script that never
    // loaded — commonly a CSP refusing `blob:` worker-src, which has to reject
    // `readyPromise` or the pool's init hangs every query against the file.
    this.worker.onerror = () => {
      this.fail(new Error('cram slice worker failed'))
    }
  }

  private handleMessage(msg: WorkerMessage) {
    if (msg.type === 'ready') {
      this.clearStartupTimer()
      this.readyResolve?.()
      this.readyResolve = undefined
      this.readyReject = undefined
      return
    }
    if (msg.type === 'initError') {
      this.fail(new Error(`cram slice worker could not start: ${msg.message}`))
      return
    }
    const cb = this.pending.get(msg.requestId)
    if (!cb) {
      return
    }
    this.pending.delete(msg.requestId)
    this.inFlight--
    if (msg.type === 'sliceResult') {
      cb.resolve(deserializeSlice(msg.payload))
    } else {
      cb.reject(reviveError(msg.name, msg.message))
    }
  }

  private clearStartupTimer() {
    if (this.startupTimer !== undefined) {
      clearTimeout(this.startupTimer)
      this.startupTimer = undefined
    }
  }

  /**
   * Retire this worker: its startup fails, and whatever slices it was carrying
   * come back undecoded for the caller to decode in-process.
   *
   * Rejecting those slices instead would fail a query the main thread can still
   * answer, over something that is not the file's fault. Startup is the one that
   * rejects, because `CramFile` turns that rejection into one warning and a
   * decode without a pool.
   */
  private fail(err: Error) {
    this.failed = true
    this.clearStartupTimer()
    const reject = this.readyReject
    const started = reject === undefined
    this.readyResolve = undefined
    this.readyReject = undefined
    reject?.(err)
    if (started) {
      // after startup nothing rejects — the slices just decode in-process from
      // here on, and the only other symptom is that queries got slower
      console.warn(
        `cram: a slice worker failed, decoding in-process instead: ${err.message}`,
      )
    }
    this.releaseAll()
  }

  private releaseAll() {
    for (const [id, cb] of this.pending) {
      this.pending.delete(id)
      cb.resolve(undefined)
    }
    this.inFlight = 0
  }

  decodeSlice(request: SliceDecodeRequest) {
    const requestId = this.nextRequestId++
    let settle: Pending | undefined
    const promise = new Promise<DecodedSlice | undefined>((resolve, reject) => {
      settle = { resolve, reject }
      this.pending.set(requestId, settle)
    })
    this.inFlight++
    // The slice bytes are transferred, not copied — but only after being sliced
    // out of the caller's buffer. `CramSlice.buildDecodeRequest` reads through
    // the file's range cache, so the buffer it hands back may be shared with
    // other readers; detaching it would corrupt them. One copy of the compressed
    // bytes, which is the smaller side of the operation.
    const bytes = request.sliceBytes.slice()
    const header = request.compressionHeaderContent.slice()
    try {
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
    } catch (e) {
      // A post that throws — a request that will not clone, a worker already
      // gone — leaves nothing to answer this requestId, so settle it here.
      // Undecoded rather than failed, like every other way the pool loses one.
      console.warn(
        `cram: could not send a slice to a worker, decoding in-process instead: ${String(e)}`,
      )
      this.pending.delete(requestId)
      this.inFlight--
      settle?.resolve(undefined)
    }
    return promise
  }

  init() {
    this.worker.postMessage({ type: 'init' })
  }

  terminate() {
    this.worker.terminate()
    this.failed = true
    this.clearStartupTimer()
    this.readyReject?.(new Error('cram slice worker pool destroyed'))
    this.readyResolve = undefined
    this.readyReject = undefined
    this.releaseAll()
  }
}

let cachedBlobUrl: string | undefined

/**
 * The worker bundle, fetched only when a pool is actually started.
 *
 * **The dynamic import is about bundle weight, and only that.** The bundle is a
 * 395 KB string — the worker's code with the wasm inlined inside it, not base64
 * despite how it reads — and a static import pins it into the initial bundle of
 * every consumer that can reach `CramFile` — which is all of them, since
 * `file.ts` imports this module to start the pool. Measured with esbuild,
 * bundling and minifying `IndexedCramFile` + `CraiIndex`:
 *
 * ```
 * static    534 KB total, of which the worker string is 266 KB — half
 * dynamic   268 KB total, worker string deferred to a split chunk
 * ```
 *
 * Half the library's bundled weight, off every consumer — including one that
 * never enables the pool, and one under node where it cannot start at all.
 * Deferring is free: the only caller, `createSliceWorkerPool`, is async.
 *
 * jbrowse applies the same trick to `@gmod/bgzf-filehandle`'s equivalent blob in
 * `util/bgzfWorkerPool.ts`, where it took an entry point from 54.7 KB to 114 B.
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
  try {
    await Promise.all(workers.map(w => w.readyPromise))
  } catch (e) {
    // One worker that cannot start says the whole arrangement is unavailable
    // here, so tear the rest down rather than run a pool of unknown width — and
    // reject, which is what `CramFile` turns into the in-process fallback.
    for (const w of workers) {
      w.terminate()
    }
    throw e
  }

  let destroyed = false
  return {
    decodeSlice(request) {
      // undefined, not a rejection: a pool that is gone or broken is a reason to
      // decode the slice here rather than a reason to fail the query
      if (destroyed) {
        return Promise.resolve(undefined)
      }
      // Least-loaded rather than round-robin. A query dispatches all its slices
      // at once and they are not the same size — a long-read slice can be
      // hundreds of times the work of a short-read one — so round-robin lands
      // several large slices on one worker while others idle.
      let chosen: ManagedWorker | undefined
      for (const w of workers) {
        if (
          !w.failed &&
          (chosen === undefined || w.inFlight < chosen.inFlight)
        ) {
          chosen = w
        }
      }
      if (chosen === undefined) {
        return Promise.resolve(undefined)
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
