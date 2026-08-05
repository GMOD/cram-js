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
 */
export function memoizeAsync<T>(fetch: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined
  return () => {
    if (result === undefined) {
      const pending = fetch()
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
