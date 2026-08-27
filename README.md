# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser. Handles CRAM 2.x and 3.x, `.crai`
indexes, and every v3 and v3.1 codec, fqzcomp and tok3 included. The codecs are
the same htscodecs C that samtools uses, compiled to WebAssembly and inlined in
the bundle, so there is nothing extra to serve or configure.

```bash
npm install @gmod/cram
```

## Quick start

```js
import { IndexedCramFile, CraiIndex } from '@gmod/cram'
import { IndexedFasta } from '@gmod/indexedfasta'

const fasta = new IndexedFasta({
  path: '/path/to/reference.fa',
  faiPath: '/path/to/reference.fa.fai',
})

const indexedFile = new IndexedCramFile({
  cramPath: '/path/to/file.cram',
  index: new CraiIndex({ path: '/path/to/file.cram.crai' }),
  fetchReferenceSequence: (seqId, start, end, refName) =>
    fasta.getSequence(refName, start, end),
})

const refId = await indexedFile.cram.getReferenceId('chr1')
const records = await indexedFile.getRecordsForRange(refId, 10000, 20000)

for (const record of records) {
  console.log(record.readName, record.start, record.getCigarString())
}
```

`cramPath` can also be `cramUrl` or `cramFilehandle`, and `CraiIndex` takes
`url` or `filehandle` in place of `path`, so the same code runs in a browser.

### Without a bundler

For `<script>`-tag consumers, igv.js among them, the package ships a standalone
browser build that puts the same exports on `window.gmodCRAM`:

```html
<script src="https://unpkg.com/@gmod/cram/dist/cram-bundle.js"></script>
<script>
  const { IndexedCramFile, CraiIndex } = window.gmodCRAM
</script>
```

The [example directory](./example) has a working page.

## Three things to know

**Coordinates are 0-based half-open**, the same as `@gmod/bam`. Add 1 when you
convert back to a 1-based text format like SAM's `POS`. (This changed in v10 —
see [MIGRATION.md](MIGRATION.md).)

**References are numbers, not names.** CRAM identifies a reference by the
position of its `@SQ` line in the SAM header, and `getRecordsForRange`,
`record.sequenceId` and the `.crai` all speak in those numbers. The order is
whatever a given file says, so ask the file rather than hardcoding it:

```js
await indexedFile.cram.getReferenceId('chr1') // 0, throws if there is no such SN
await indexedFile.cram.getReferenceName(0) // 'chr1'
await indexedFile.cram.getReferenceInfo() // [{ name, length, md5 }, ...]
```

The one id that is not an `@SQ` position is `-1`, an unplaced read.

**You supply the reference sequence.** CRAM stores reads as differences from a
reference, so the library cannot give you bases without one —
`fetchReferenceSequence` is how it asks for them. It receives both the seq id
and the name, so a name-keyed source like `IndexedFasta` needs no lookup of its
own. Without it you still get positions, CIGARs and the _shape_ of every
difference, just not the bases involved.

## What to ask a record

```js
record.getReadBases() // 'ACGT…', the read sequence
record.getCigarString() // '50M2I48M'
record.getMismatches() // every difference from the reference
record.getTag('NM') // one auxiliary tag
record.qualityScoreAt(0) // one base quality
record.isReverseComplemented() // the usual SAM flags
```

`getMismatches()` is the intended way to see how a read differs from the
reference. You should not need to know anything about how CRAM encodes it:

```js
for (const m of record.getMismatches()) {
  console.log(
    String.fromCharCode(m.code), // 'X', 'I', 'D', 'N', 'S' or 'H'
    m.refPos, // 0-based reference position
    m.length, // reference bases covered (deletions, skips)
    m.bases, // substituted or inserted bases
    m.clipLength, // read bases consumed (insertions, clips)
  )
}
```

If you process enough records that per-difference objects start to matter,
`record.forEachMismatch(callback, opts?)` reports the same differences without
allocating, and takes an optional `{ start, end }` window. The same pattern
exists for the CIGAR (`forEachCigarOp`) and for tags and quality scores, which
live in one array per slice rather than one per record.
[docs/api.md](docs/api.md) has all of it; [docs/memory.md](docs/memory.md)
explains why they take that shape.

## Slices decode on a worker pool

A query decodes one or more slices, and slices are independent. Since 12.1 they
decode on a shared pool of workers wherever the host has them — on by default,
with nothing to configure, since the worker ships inlined like the wasm:

```js
// already parallel
const records = await indexedFile.getRecordsForRange(refId, 10000, 20000)
```

In a browser that is worth 2.1-3.6x once a query touches four or more slices,
and roughly break-even on the single-slice queries shallow files produce.
**Leave it on even if you already run this library inside your own worker** — a
worker is one thread, and the pool nested inside one is where those numbers were
measured.

`useSliceWorkerPool: false` turns it off and `numSliceWorkers` sizes it. The
reason to reach for either is a host that runs several worker contexts, since
one pool serves a context rather than a machine.
[docs/workers.md](docs/workers.md) has the measurements.

## Reading over HTTP

An indexed query reads a file as many small byte ranges — a whole-reference
query on a 141 KB test file issues 545 of them, half of those under 80 bytes. A
bare `RemoteFile` turns each one into its own range request, so put
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
underneath:

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const cram = new IndexedCramFile({
  cramFilehandle: new RemoteFileWithRangeCache(url),
  index: new CraiIndex({
    filehandle: new RemoteFileWithRangeCache(`${url}.crai`),
  }),
})
```

The cache serves those reads out of 256 KiB chunks, so neighboring reads share a
request and the 545 become a handful. It also threads the `AbortSignal` below,
which is what makes the next section worth anything over a network.

## Cancelling a query

Pass an `AbortSignal` and the query stops decoding and drops the fetch it has in
flight:

```js
const controller = new AbortController()
const records = indexedFile.getRecordsForRange(0, 1000, 2000, {
  signal: controller.signal,
})
controller.abort() // `records` rejects with an AbortError
```

Aborting your query never fails a concurrent one, because decodes shared between
queries are reference-counted. The corollary is the thing to know: a query with
**no** signal can never give up, so it pins any slice it is waiting on for
everyone. Thread the signal through consistently.
[docs/api.md](docs/api.md#cancelling-a-query) has the details.

## Docs

- [docs/api.md](docs/api.md) — every option, property and method
- [MIGRATION.md](MIGRATION.md) — breaking changes, newest first
- [docs/memory.md](docs/memory.md) — what a decoded slice retains
- [docs/read-features.md](docs/read-features.md) — the raw alignment encoding
- [docs/codec-support.md](docs/codec-support.md) — which codecs this decoder
  handles
- [docs/dataflow.md](docs/dataflow.md) — a query end to end, diagrammed
- [docs/optimizations.md](docs/optimizations.md) — why the path looks that way
- [docs/wasm.md](docs/wasm.md) — the inlined wasm build
- [docs/workers.md](docs/workers.md) — the slice worker pool
- [docs/adr/](docs/adr/) — the decisions, with their measurements
- [TODO.md](TODO.md) — measured, still open, wanted
- [CONTRIBUTING.md](CONTRIBUTING.md) — development, release, publishing

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
