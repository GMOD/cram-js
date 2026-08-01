import type CramRecord from './record.ts'

interface Entry {
  promise: Promise<CramRecord[]>
  /** records held by this entry, counted once its promise resolves */
  records: number
  /** read or written during the batch currently decoding; see `evict` */
  touched: boolean
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
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return undefined
    }
    entry.touched = true
    // re-insert to mark as most recently used
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.promise
  }

  set(key: string, promise: Promise<CramRecord[]>) {
    this.drop(key)
    this.pending++
    const entry: Entry = { promise, records: 0, touched: true }
    this.entries.set(key, entry)
    promise.then(
      records => {
        this.pending--
        // the entry may have been evicted or replaced while decoding
        if (this.entries.get(key) === entry) {
          entry.records = records.length
          this.totalRecords += records.length
        }
        this.settled()
      },
      () => {
        this.pending--
        // Drop failed decodes rather than caching the rejection: otherwise one
        // transient read error poisons that slice for the lifetime of the file
        // and every later query re-awaits the same rejected promise. Mirrors
        // the self-clearing memoization used for headers and blocks.
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
        this.settled()
      },
    )
  }

  private settled() {
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
