# 0001 — Codecs bind their own per-slice fast paths

**Status:** accepted

## Context

A CRAM data series is read through a codec chosen by the file's compression
header. The generic entry point is
`CramCodec.decode(coreDataBlock, blocksByContentId, cursors)`, which on every
call has to find the content block in a `Record`, find its cursor in a `Map`,
and join whatever per-slice state the codec needs — all of it fixed for the
whole slice.

The first attempt at avoiding that was an `instanceof` chain in
`slice/decodeContext.ts` that recognized particular codec combinations and
inlined a faster read for each. It had two problems, and both bit:

- It was a **fourth copy** of the External, ByteArrayStop and ByteArrayLength
  reads, bounds checks included, written where the chain could see them rather
  than where the codec's own knowledge is.
- A combination nobody thought to enumerate silently fell through to full
  dispatch. That happened twice. `byteArrayLength` data series always did, and
  `byteArrayLength` tags did whenever their length was not external — which is
  exactly the fixed-width tags, whose length is a zero-bit huffman code and
  therefore free. That one put `getBytesSubarray` at 6.1% of the SRR396637
  profile: 109,580 calls for 54,695 records, two per record, both from tags.

The failure mode is the point. A fast path that is conditional on a combination
someone remembered to name will keep missing the combinations they did not.

## Decision

Each codec binds its own fast path, through a family of `bind*` methods on
`CramCodec`. A binder is called once per slice and returns a closure with the
per-slice lookups already done; the base class supplies a default so that a
codec with nothing to hoist needs no code at all.

| binder             | returns                   | default                                                |
| ------------------ | ------------------------- | ------------------------------------------------------ |
| `bindDecoder`      | `() => value`             | the generic `decode`                                   |
| `bindBytesReader`  | `(length) => Uint8Array`  | `undefined` — caller reads a value at a time           |
| `bindStringReader` | `() => string`            | `undefined` — caller decodes the bytes                 |
| `bindUintReader`   | `(width) => () => number` | `undefined` — caller reads the number out of the bytes |

Two rules make this compose rather than accumulate special cases:

1. **A binder that cannot do better returns `undefined`**, and the caller has a
   correct slower path. So adding a binder never introduces a way to be wrong,
   only a way to be faster.
2. **A composite codec binds through its parts.** `ByteArrayLength` binds its
   length side through _its_ codec, whatever that is, and takes its values
   through `bindBytesReader` — rather than testing whether the pair is a
   combination it recognizes.

Huffman, Beta, Gamma and Subexp keep every default: their state is already in
the codec, so there is nothing per-slice to hoist.

## Consequences

- `decodeContext.ts` stopped being a place where codec internals are
  re-implemented. It went 480 → 333 lines when the chain came out, and
  `bindTagReaders` became a loop.
- The reads are written once each and shared by `decode()` and the bound
  closure, which now differ only in how much lookup each has already done.
- **New fast paths land as one codec method**, not as another arm of a chain
  every caller has to be re-checked against. Both later additions —
  `bindStringReader` (ADR [0002](0002-batch-decoding-over-lazy-fields.md)) and
  `bindUintReader` — were exactly that shape.
- The cost is indirection: reading a value is a call through a closure the
  binder chose, so what actually runs is not visible at the call site. The
  binders are small and each is used from one place, which is what keeps that
  tolerable.
- A binder holding per-slice state in its closure **must be called once per
  slice**, not cached on the codec. The compression scheme is memoized per
  container and hands the _same_ codec instance to every slice in it, so state
  cached on `this` would leak across slices. Every binder therefore captures its
  state in the returned closure.

## Evidence

The refactor that introduced the seam claimed no performance change, and that
was checked rather than assumed: 14 paired rounds put it at +1.0% on SRR396637
(sd 4.5, faster in 9/14) and −1.1% on ONT (sd 1.6, faster in 5/14) — a wash in
both directions, which is the right outcome for a refactor. Notably the first 6
rounds had suggested 3–4% in its favor; it did not survive 8 more.

What the seam was worth showed up in what it then made easy. Verified during a
decode of SRR396637: zero generic `decode()` calls reach External,
ByteArrayLength or ByteArrayStop — every read goes through a bound closure,
which is more than was true when the `instanceof` chain was doing the work.
