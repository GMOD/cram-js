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
inlined a faster read for each. The chain had two problems, and both showed up
in practice:

- It was a **fourth copy** of the External, ByteArrayStop and ByteArrayLength
  reads, bounds checks included, written in the chain instead of in the codec
  classes that define those encodings.
- A combination nobody had enumerated fell through to full dispatch with no
  warning. That happened twice. `byteArrayLength` data series always fell
  through, and `byteArrayLength` tags did whenever their length was not
  external. Those are exactly the fixed-width tags, whose length is a zero-bit
  huffman code that reads no bits at all. The tag case put `getBytesSubarray` at
  6.1% of the SRR396637 profile: 109,580 calls for 54,695 records, two per
  record, both from tags.

The chain took the fast path only for the combinations someone had listed, and
sent every other combination to full dispatch.

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

Two rules let the binders compose without special cases:

1. **A binder that cannot do better returns `undefined`**, and the caller has a
   correct slower path. A new binder can therefore make a read faster, but it
   cannot make it wrong.
2. **A composite codec binds through its parts.** `ByteArrayLength` binds its
   length side through _its_ codec, whatever that is, and reads its values
   through `bindBytesReader`, instead of testing whether the pair is a
   combination it recognizes.

Huffman, Beta, Gamma and Subexp keep every default: their state is already in
the codec, so there is nothing per-slice to hoist.

## Consequences

- `decodeContext.ts` no longer re-implements codec internals. It went 480 → 333
  lines when the chain came out, and `bindTagReaders` became a loop.
- The reads are written once each and shared by `decode()` and the bound
  closure, which now differ only in how much lookup each has already done.
- **A new fast path is one codec method**, instead of another arm of a chain
  that every caller has to be re-checked against. The two later additions,
  `bindStringReader` (ADR [0002](0002-batch-decoding-over-lazy-fields.md)) and
  `bindUintReader`, were each one codec method.
- The cost is indirection. Reading a value is a call through a closure the
  binder chose, so the call site does not show which code runs. The binders are
  small and each is used from one place, so the indirection stays tolerable.
- A binder holding per-slice state in its closure **must be called once per
  slice**, not cached on the codec. The compression scheme is memoized per
  container and hands the _same_ codec instance to every slice in it, so state
  cached on `this` would leak across slices. Every binder therefore captures its
  state in the returned closure.

## Evidence

We expected the refactor that introduced the seam to leave performance
unchanged, and measured it. Over 14 paired rounds it came out at +1.0% on
SRR396637 (sd 4.5, faster in 9/14) and −1.1% on ONT (sd 1.6, faster in 5/14),
within noise in both directions, as a refactor should be. The first 6 rounds had
suggested 3–4% in its favor, and the 8 rounds after them erased it.

The seam made later fast paths possible. During a decode of SRR396637, zero
generic `decode()` calls reach External, ByteArrayLength or ByteArrayStop, and
every read goes through a bound closure. Under the `instanceof` chain, some of
those reads still went through `decode()`.
