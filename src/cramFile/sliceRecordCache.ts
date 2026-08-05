import type CramRecord from './record.ts'

interface Entry {
  promise: Promise<CramRecord[]>
  /** records held by this entry, counted once its promise resolves */
  records: number
  /** read or written during the batch currently decoding; see `evict` */
  touched: boolean
  /** signals of the consumers still waiting on this decode */
  signals: Set<AbortSignal>
  /** true once a consumer joins without a signal; see `join` */
  pinned: boolean
  /** aborts when every consumer has given up. what the decode runs under */
  controller: AbortController
  /** aborted to take this entry's listeners back off its consumers' signals */
  dispose: AbortController
  settled: boolean
}

/**
 * LRU cache of decoded slices, bounded by the number of **records** it holds
 * rather than the number of slices.
 *
 * One slice holds anywhere from a handful of records to tens of thousands, and
 * on long-read data a single slice can retain tens of megabytes — so bounding
 * by entry count makes the bound meaningless. (A 20,000-*slice* bound is
 * hundreds of gigabytes, i.e. "never evict".)
 *
 * A slice's record count is not known until its promise resolves, so entries
 * are weighed on resolution. Map insertion order is the LRU order; a hit moves
 * the key to the end.
 *
 * Note the bound counts records, not bytes: a long read retains far more than a
 * short one, so the same limit means very different memory for different files.
 * Bytes would be a better unit, but there is no cheap way to size a decoded
 * record; records at least makes the documented contract true.
 *
 * ## Cancellation
 *
 * This is the one read shared between concurrent queries, so it is the one
 * place a cancellation could leak from the query that asked for it to a query
 * that did not. The decode does not run under any one caller's signal — it runs
 * under {@link Entry.controller}, which aborts only once **every** consumer
 * that joined has given up. A caller's own abort is then reported to that
 * caller alone, by {@link getOrFill} re-checking it after the shared promise
 * settles.
 *
 * That is the reference-counted model `@gmod/abortable-promise-cache` gives
 * `@gmod/tabix` and `@gmod/bbi`. It is implemented here rather than taken as a
 * dependency because that package wants to own the cache, and this one is not a
 * plain LRU — the record-count bound above needs to weigh each entry when its
 * promise resolves, which means owning the entries.
 *
 * The earlier version of this cancelled the decode under whichever caller
 * started it and had joiners retry when that caller aborted. It was correct,
 * but it threw away work: a pan cancels the query in flight while the next
 * query wants most of the same slices, so exactly the slices still decoding got
 * decoded twice. Ref-counting keeps them. See ADR 0003.
 */
export default class SliceRecordCache {
  private entries = new Map<string, Entry>()
  private totalRecords = 0
  private maxRecords: number
  /** entries whose promise has not settled yet */
  private pending = 0

  constructor(maxRecords: number) {
    this.maxRecords = maxRecords
  }

  get(key: string) {
    return this.touch(key)?.promise
  }

  private touch(key: string) {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return undefined
    }
    entry.touched = true
    // re-insert to mark as most recently used
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  /**
   * The decoded slice under `key`, running `fill` only on a miss.
   *
   * `fill` is handed the aggregated signal, not `signal` — it must decode under
   * the interest of *every* consumer, not just the one that happened to arrive
   * first. `signal` is what this particular caller gets an answer about.
   */
  async getOrFill(
    key: string,
    signal: AbortSignal | undefined,
    fill: (signal: AbortSignal) => Promise<CramRecord[]>,
  ): Promise<CramRecord[]> {
    signal?.throwIfAborted()

    let entry = this.touch(key)
    // An entry every consumer has abandoned is on its way out but may not have
    // noticed yet — its fill only learns of the abort a microtask later. Start
    // a fresh decode rather than joining one that is already doomed.
    if (entry?.controller.signal.aborted && !entry.settled) {
      this.drop(key)
      entry = undefined
    }
    entry ??= this.start(key, fill)
    this.join(entry, signal)

    try {
      const records = await entry.promise
      // the decode finished, but this caller gave up while waiting for it
      signal?.throwIfAborted()
      return records
    } catch (e) {
      // Prefer this caller's own cancellation to whatever the shared decode
      // reported. If we asked to stop, that is the answer we want — and when
      // the decode itself was cancelled it is because we, and everyone else,
      // asked it to.
      signal?.throwIfAborted()
      throw e
    }
  }

  /**
   * Register a consumer's interest, so the decode survives until that consumer
   * has given up too.
   *
   * A consumer with **no signal cannot give up**, so it pins the decode: there
   * is no longer any set of aborts that should stop it. That is the honest
   * reading of a caller that never asked to be cancellable, and it means a
   * single signal-free query joining a slice makes that slice's decode
   * uncancellable for everyone — which is why `getRecordsForRange` threads its
   * signal all the way down rather than dropping it anywhere convenient.
   */
  private join(entry: Entry, signal: AbortSignal | undefined) {
    if (signal === undefined) {
      entry.pinned = true
    } else if (!entry.signals.has(signal)) {
      // guarded so one signal joining twice — a viewAsPairs query reaching the
      // same slice for a read and for its mate — does not add two listeners
      entry.signals.add(signal)
      signal.addEventListener(
        'abort',
        () => {
          entry.signals.delete(signal)
          if (!entry.pinned && entry.signals.size === 0) {
            entry.controller.abort(signal.reason)
          }
        },
        // `once` covers the abort firing; `dispose` covers it never firing, so
        // a settled entry does not keep listeners on signals for as long as the
        // LRU holds its records
        { once: true, signal: entry.dispose.signal },
      )
    }
  }

  private start(key: string, fill: (signal: AbortSignal) => Promise<CramRecord[]>) {
    this.drop(key)
    const controller = new AbortController()
    const entry: Entry = {
      promise: fill(controller.signal),
      records: 0,
      touched: true,
      signals: new Set(),
      pinned: false,
      controller,
      dispose: new AbortController(),
      settled: false,
    }
    this.pending++
    this.entries.set(key, entry)

    // Evict as soon as the last consumer gives up rather than waiting for the
    // fill to reject, so a query arriving in that window starts its own decode
    // instead of joining this one just to be told it was cancelled.
    controller.signal.addEventListener(
      'abort',
      () => {
        if (!entry.settled && this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
      },
      { once: true },
    )

    entry.promise.then(
      records => {
        this.finish(entry)
        // the entry may have been evicted or replaced while decoding
        if (this.entries.get(key) === entry) {
          entry.records = records.length
          this.totalRecords += records.length
        }
        this.batchSettled()
      },
      () => {
        this.finish(entry)
        // Drop failed decodes rather than caching the rejection: otherwise one
        // transient read error poisons that slice for the lifetime of the file
        // and every later query re-awaits the same rejected promise. Mirrors
        // the self-clearing memoization used for headers and blocks.
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
        this.batchSettled()
      },
    )
    return entry
  }

  private finish(entry: Entry) {
    this.pending--
    entry.settled = true
    // nothing reads these once the promise has settled, and holding them would
    // pin every consumer's AbortController for as long as the slice is cached
    entry.dispose.abort()
    entry.signals.clear()
  }

  private batchSettled() {
    if (this.pending === 0) {
      this.evict()
    }
  }

  private drop(key: string) {
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      this.totalRecords -= existing.records
      this.entries.delete(key)
    }
  }

  /**
   * Evict least-recently-used entries until back under budget, sparing every
   * entry the batch that just finished touched.
   *
   * Eviction deliberately waits for the whole batch rather than running as each
   * slice lands. `getRecordsForRange` starts every slice of a range at once and
   * holds all of their records until it returns, so evicting one mid-query
   * frees nothing — but it does guarantee the next identical query re-decodes
   * it. A range holding more records than the whole budget would otherwise
   * evict its own earlier slices as its later ones landed, which is the worst
   * case for a plain LRU: a 55,000-record range against the default
   * 20,000-record budget re-read 1.9 MB and re-inflated 6.0 MB on every repeat,
   * 117 ms against the 12 ms it takes when the slices survive.
   *
   * Sparing the touched entries is also what keeps a slice bigger than the
   * whole budget cached at all, rather than evicting itself the moment it
   * landed.
   */
  private evict() {
    for (const [key, entry] of this.entries) {
      if (this.totalRecords <= this.maxRecords) {
        break
      }
      if (!entry.touched) {
        this.entries.delete(key)
        this.totalRecords -= entry.records
      }
    }
    for (const entry of this.entries.values()) {
      entry.touched = false
    }
  }
}
