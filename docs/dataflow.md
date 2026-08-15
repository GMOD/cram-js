# How a query flows

<img src="img/dataflow.svg" alt="cram-js data flow" width="820">

[dataflow.dot](img/dataflow.dot) is the source; see
[CONTRIBUTING.md](../CONTRIBUTING.md) for how to re-render it.

A query turns its range into a list of `.crai` slice entries, and from there
every slice runs in parallel. Each one resolves its container — the header and
compression header block, memoized for the query, since a container holds
several slices — and then asks `featureCache` for the decoded records. A hit
returns them already decoded and already decorated with their reference, so all
a repeat query pays is the filter. A miss reads the slice's whole block region
in one go and decodes it: walk the blocks, decompress each by its method byte,
build the per-slice decode context, then one pass over the records into the
read-feature arena and the tag and quality columns.

Why each of those steps looks the way it does, and what measured it, is
[optimizations.md](optimizations.md).

The diagram is the main path only. It leaves out the file definition and SAM
header, which are file-wide memos every query after the first joins already
resolved; non-indexed access through `CramFile` directly, which walks containers
and reads blocks one at a time; the mate pass re-entering the index and the
cache for slices it did not already have; and cache eviction, which is LRU plus
an idle sweep.

## What the decode writes into

The record pass does not build `{code, pos, refPos, data}` objects. Read
features go into a **per-slice arena** — struct-of-arrays typed columns, with
each record holding a start and a count into them — and tags and quality scores
into columns of their own. Read features dominate decoded-record memory on long
reads (a 37-record ONT slice decodes 213k of them), and 15 bytes of columns per
feature against 64 per object is the difference between a slice you can cache
and one you cannot.

That shape is load-bearing for the two steps after it. The arena is sized up
front from the slice's own blocks rather than grown, since reallocating seven
columns is where a long-read slice spends its decode time; and being typed
arrays is what lets a worker transfer the result at zero copy instead of
structured-cloning an object graph. [memory.md](memory.md#columns-not-objects)
has the per-column costs, [read-features.md](read-features.md) how to read them
without materializing anything.

## Where the slice decode happens

Everything in the blue box runs on a **worker pool** when the host has one — a
`Worker` from a Blob URL, both of them inlined, so there is nothing to
configure. The pool is shared per JS context, as in
[bam-js](https://github.com/GMOD/bam-js/blob/main/docs/dataflow.md), but the
unit is the **whole slice** rather than just decompression, which is why it is a
box around several steps there and a single node in bam's diagram: block
decompression is only 24–35% of a cold query, so a decompression-only pool caps
out around 1.33x where this measures 2.0–3.6x. Anything that cannot start a pool
decodes in-process instead, which is the same code on the same thread that
asked.

Two things stay behind on the main thread whatever happens. The slice is
described to the worker as **bytes and numbers only** — a `CramFile` holds a
filehandle and your `fetchReferenceSequence` callback, neither of which can
travel — and coming back, the columns transfer at zero copy rather than being
cloned. Then `applyReferenceSequence` runs here, because resolving substitutions
means calling that callback. [workers.md](workers.md) has the measurements and
the fallbacks.

## Where wasm sits

Everything orange is wasm: `htscodecs.wasm` for gzip (through libdeflate),
bzip2, and every CRAM codec from rANS to fqzcomp and tok3, plus a second 16 KB
`xz-embedded.wasm` for lzma, which htscodecs has no codec for at all. Both are
inlined in the bundle and instantiated lazily, once per JS context.

The `.crai` goes through it too, though the diagram does not draw that edge —
the index is gzipped, so the first wasm call of a session is usually gunzipping
it rather than decompressing a block.

The boundary is crossed **once per block**, never per record: each crossing
copies its input into the wasm heap and its output back out, and a block's two
copies amortize over the thousands of records in it. Everything above the block
— the data-series codecs, the record decode, the columns — is JS reading bytes
that are already in the JS heap. [wasm.md](wasm.md) has the rest of that
argument, and [codec-support.md](codec-support.md) the codec list.
