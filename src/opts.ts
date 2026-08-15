/**
 * Options every read-issuing call in the library accepts.
 *
 * Shared with the other GMOD indexed-format readers (`@gmod/bam`,
 * `@gmod/tabix`, `@gmod/bbi`) so an application threading one stop token
 * through its adapters passes the same object shape to all of them.
 */
export interface BaseOpts {
  /**
   * Cancels the reads issued on this call's behalf.
   *
   * Reads shared with another in-flight query are *not* cancelled out from
   * under it — see `CramFile.featureCache` and `CraiIndex.getIndexData`, which
   * both start over rather than let one caller's cancellation surface as
   * another's failure. What aborting guarantees is that *this* call rejects,
   * and that no further bytes are fetched only for it.
   *
   * Whether an abort actually stops bytes already in flight is the
   * filehandle's business: `RemoteFile` passes the signal to `fetch`, so a
   * range request is torn down mid-transfer, while `LocalFile` ignores it and
   * the read runs to completion — the call still rejects, it just does not
   * save the disk I/O.
   */
  signal?: AbortSignal
  /**
   * Called with cumulative downloaded bytes and, when it is known, the total.
   * Lets callers render a determinate progress bar.
   */
  onProgress?: (bytesDownloaded: number, totalBytes?: number) => void
}

/**
 * The part of {@link BaseOpts} the internal read path carries.
 *
 * Deliberately not all of it. `onProgress` reports bytes for *one* read, and a
 * query issues many — a container header, a slice header, the block bulk read,
 * per slice — so forwarding it down here would interleave a dozen counters that
 * each restart at zero, rather than the single slice-granularity bar
 * `getRecordsForRange` reports.
 */
export type ReadOpts = Pick<BaseOpts, 'signal'>
