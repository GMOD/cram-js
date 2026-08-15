# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser. CRAM 2.x and 3.x, `.crai` indexes, and
every v3 and v3.1 codec — including fqzcomp and tok3 — decoded in WebAssembly
built from the same htscodecs C that samtools uses, inlined in the bundle so
there is nothing extra to serve or configure.

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

`cramPath` can also be `cramUrl` or `cramFilehandle` (and `CraiIndex` takes
`url` or `filehandle`), so the same code runs in a browser.

### Without a bundler

The package also ships a standalone browser build for consumers that load it
from a `<script>` tag rather than through npm — igv.js among them. It puts the
same exports on `window.gmodCRAM`:

```html
<script src="https://unpkg.com/@gmod/cram/dist/cram-bundle.js"></script>
<script>
  const { IndexedCramFile, CraiIndex } = window.gmodCRAM
</script>
```

See the [example directory](./example) for a working page. Nothing else in this
repo imports `dist/cram-bundle.js` — it exists for those consumers, which is
worth knowing before deciding it looks unused.

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
reference, so the library cannot give you bases without one:
`fetchReferenceSequence` is how it asks. It is handed both the seq id and the
name, so a name-keyed source like `IndexedFasta` needs no lookup. Without it you
still get positions, CIGARs and the _shape_ of every difference — just not the
bases involved.

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
reference — you should not need to know anything about how CRAM encodes it:

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

If you are processing enough records that per-difference objects start to
matter, `record.forEachMismatch(callback, opts?)` reports exactly the same
differences without allocating, and takes an optional `{ start, end }` window.
The same pattern exists for the CIGAR (`forEachCigarOp`) and for tags and
quality scores, which are stored as one array per slice rather than per record.
[docs/API.md](docs/API.md) has all of it; [docs/MEMORY.md](docs/MEMORY.md)
explains why it is shaped that way.

## Slices decode on a worker pool

A query decodes one or more slices, slices are independent, and since 12.1 they
decode on a shared pool of workers wherever the host has them. This is on by
default and needs no configuration — the worker ships inlined, like the wasm, so
there is nothing to serve or wire up:

```js
// already parallel
const records = await indexedFile.getRecordsForRange(refId, 10000, 20000)
```

In a browser it is worth 2.1-3.6x once a query touches four or more slices, and
parity on the one-slice queries that shallow files give. **Leave it on even if
you already run this library inside your own worker** — a worker is one thread,
and the pool nested inside one is where those numbers were measured.

`useSliceWorkerPool: false` turns it off and `numSliceWorkers` sizes it; the
reason to reach for either is a host that runs several worker contexts, since
the pool is shared per context rather than per machine.
[docs/WORKERS.md](docs/WORKERS.md) has the measurements.

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

Aborting your query never fails a concurrent one — decodes shared between
queries are reference-counted. The one thing to know is the corollary: a query
with **no** signal can never give up, so it pins any slice it is waiting on for
everyone. Thread the signal through consistently.
[docs/API.md](docs/API.md#cancelling-a-query) has the details.

## Docs

- [docs/API.md](docs/API.md) — the full API: every option, property and method
- [MIGRATION.md](MIGRATION.md) — breaking changes, newest first
- [docs/MEMORY.md](docs/MEMORY.md) — what a decoded slice retains, and how to
  read records in bulk without allocating
- [docs/READ_FEATURES.md](docs/READ_FEATURES.md) — the raw CRAM alignment
  encoding behind `record.readFeatures`. You don't need it for mismatches
- [docs/CODEC_SUPPORT.md](docs/CODEC_SUPPORT.md) — which codecs are supported
- [docs/dataflow.dot](docs/dataflow.dot) ([rendered](docs/dataflow.svg)) — a
  query end to end on one page: index, container, slice cache, decode,
  reference, and where the wasm sits
- [docs/WASM.md](docs/WASM.md) — the inlined wasm build: 55 KB gzipped, ~5 ms
  one-time startup, 16 MB heap
- [docs/WORKERS.md](docs/WORKERS.md) — the slice worker pool: what it is worth,
  what crosses the boundary, and how the inlined worker is built
- [docs/adr/](docs/adr/) — why the decoder is put together the way it is, with
  the measurements that settled each decision, and [TODO.md](TODO.md) for what
  is still open

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```
