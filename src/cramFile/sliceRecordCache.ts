import type CramRecord from './record.ts'

interface Entry {
  promise: Promise<CramRecord[]>
  /** records held by this entry, counted once its promise resolves */
  records: number
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
 * are weighed on resolution and eviction runs then. Map insertion order is the
 * LRU order; a hit moves the key to the end.
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

  constructor(maxRecords: number) {
    this.maxRecords = maxRecords
  }

  get(key: string) {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return undefined
    }
    // re-insert to mark as most recently used
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.promise
  }

  set(key: string, promise: Promise<CramRecord[]>) {
    this.drop(key)
    const entry: Entry = { promise, records: 0 }
    this.entries.set(key, entry)
    promise.then(
      records => {
        // the entry may have been evicted or replaced while decoding
        if (this.entries.get(key) === entry) {
          entry.records = records.length
          this.totalRecords += records.length
          this.evict(key)
        }
      },
      () => {
        // Drop failed decodes rather than caching the rejection: otherwise one
        // transient read error poisons that slice for the lifetime of the file
        // and every later query re-awaits the same rejected promise. Mirrors
        // the self-clearing memoization used for headers and blocks.
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
      },
    )
  }

  private drop(key: string) {
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      this.totalRecords -= existing.records
      this.entries.delete(key)
    }
  }

  /**
   * Evict least-recently-used entries until back under budget, never evicting
   * `keepKey` — a slice bigger than the whole budget would otherwise evict
   * itself the moment it landed and never be served from cache at all.
   */
  private evict(keepKey: string) {
    for (const [key, entry] of this.entries) {
      if (this.totalRecords <= this.maxRecords) {
        break
      }
      if (key !== keepKey) {
        this.entries.delete(key)
        this.totalRecords -= entry.records
      }
    }
  }
}
