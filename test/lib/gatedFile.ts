import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
} from 'generic-filehandle2'

/**
 * A filehandle wrapper for testing cancellation, which needs two things
 * `LocalFile` cannot give.
 *
 * It **honours the signal**: `LocalFile` ignores `opts.signal` outright and
 * every read runs to completion, so nothing in the tests would ever observe an
 * interrupted read. `RemoteFile` does honour it — it hands the signal to
 * `fetch` — so this is the behaviour a browser consumer actually gets.
 *
 * It **holds reads open on demand**, so a test can park a read mid-flight,
 * arrange whatever it wants around it, and then decide whether that read is
 * abandoned or released. Without it a cancellation test is a race against how
 * long the filesystem takes.
 */
/** an abort reason as something that can be thrown */
function toError(reason: unknown) {
  return reason instanceof Error ? reason : new Error(String(reason))
}

export default class GatedFile implements GenericFilehandle {
  private inner: GenericFilehandle

  /** every `read` issued since the last {@link reset}, as `[length, position]` */
  reads: [number, number][] = []
  /** how many `readFile` calls have been issued since the last {@link reset} */
  readFiles = 0
  /** reads that were still parked when their signal aborted */
  abortedReads = 0

  private held = false
  private release: (() => void)[] = []

  constructor(inner: GenericFilehandle) {
    this.inner = inner
  }

  /** park every read issued from now on */
  hold() {
    this.held = true
  }

  /** let the parked reads through, and stop parking new ones */
  open() {
    this.held = false
    const waiting = this.release
    this.release = []
    for (const resume of waiting) {
      resume()
    }
  }

  /**
   * Forget what has been read so far, so a test can warm the file up and then
   * count only what the query under test issues.
   */
  reset() {
    this.reads = []
    this.readFiles = 0
    this.abortedReads = 0
  }

  /** resolves once at least `n` reads have been issued since the last reset */
  async waitForReads(n: number) {
    while (this.reads.length < n) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  private async gate(opts?: Omit<FilehandleOptions, 'encoding'>) {
    if (!this.held) {
      return
    }
    const signal = opts?.signal
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        this.abortedReads++
        this.release = this.release.filter(r => r !== resume)
        reject(toError(signal!.reason))
      }
      this.release.push(resume)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async read(length: number, position: number, opts?: FilehandleOptions) {
    this.reads.push([length, position])
    await this.gate(opts)
    return this.inner.read(length, position, opts)
  }

  readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  async readFile(
    options?: BufferEncoding | FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    this.readFiles++
    if (typeof options === 'string') {
      await this.gate()
      return this.inner.readFile(options)
    }
    const { encoding, ...rest } = options ?? {}
    await this.gate(rest)
    return encoding === undefined
      ? this.inner.readFile(rest)
      : this.inner.readFile({ ...rest, encoding })
  }

  stat() {
    return this.inner.stat()
  }

  close() {
    return this.inner.close()
  }
}

/**
 * Drain the microtask queue.
 *
 * A `setTimeout` callback runs only once every pending microtask has, so
 * awaiting one is how these tests say "let every promise chain that can make
 * progress make it" without guessing at a number of `await`s.
 */
export function drainMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0))
}
