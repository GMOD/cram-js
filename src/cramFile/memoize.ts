/**
 * Memoize an async fetch, forgetting the result if it rejects.
 *
 * The read path is a stack of these — the file definition and SAM header, each
 * container's header and compression scheme, each slice's header, blocks and
 * content-id index — and every one of them has to drop a rejection rather than
 * keep it. Caching the rejected promise would let one transient read error
 * poison that header for the lifetime of the file, with every later query
 * re-awaiting the same failure. `SliceRecordCache` documents the same hazard
 * for decoded records.
 *
 * Concurrent callers still share one in-flight fetch; only a *settled*
 * rejection clears the memo, so a retry after the failure starts a new one.
 *
 * **The first caller's arguments win.** Later callers join the fetch that is
 * already running, so whatever they pass is ignored. Only pass arguments that
 * cannot change the result: here that is the `AbortSignal`, which picks *who
 * may cancel* the read rather than what it returns. The objects these memos
 * live on — `CramContainer` and `CramSlice` — are built fresh per query, so
 * every caller of one memo is in practice the same query carrying the same
 * signal. The one read genuinely shared between queries is the decoded slice in
 * `SliceRecordCache`, which handles the cross-query case explicitly rather than
 * relying on this.
 */
export function memoizeAsync<A extends unknown[], T>(
  fetch: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  let result: Promise<T> | undefined
  return (...args: A) => {
    if (result === undefined) {
      const pending = fetch(...args)
      result = pending
      pending.catch(() => {
        // identity-checked so a retry started after this rejection is not
        // cleared by the failure it already replaced
        if (result === pending) {
          result = undefined
        }
      })
    }
    return result
  }
}
