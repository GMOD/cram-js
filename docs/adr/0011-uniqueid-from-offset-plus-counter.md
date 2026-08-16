# 0011 — Derive `uniqueId` from the slice's file offset and the record counter

**Status:** accepted

## Context

Every decoded record carries a `uniqueId`, which JBrowse uses as its feature id
and which `IndexedCramFile` uses to recognise a record it has already collected
when it goes back for mates. It is

```
sliceHeader.contentPosition + recordCounter + 1 + i
```

— the file offset of the slice header, plus the record counter that header
stores, plus the record's index within the slice.

[Issue #161](https://github.com/GMOD/cram-js/issues/161) asks whether the record
counter is the right field to hang that on. `CRAMv3.tex` defines it as

> `ltf8` record counter — 0-based sequential index of records in the file/stream

which says what a writer should write, not what a reader may verify; James
Bonfield's point in the issue is that nothing makes the value unique, and a
reader cannot check it without reading the whole file. Two cases put that beyond
hypothetical: CRAM v1 has no such field at all, so `readRecordCounter` returns 0
for every slice in one, and a writer that never fills the field in produces the
same thing in v2 or v3.

That the field's own definition has moved is a small argument for the same
caution. `CRAMv2.1.tex` still calls it **1-based** and `CRAMv3.tex` calls it
**0-based**, and every file in `test/data` — v2.1 ones included — starts at 0.
The issue quotes the 1-based wording.

htslib takes the counter at its word. `cram_decode.c` builds the synthetic read
names for a lossy-names file out of `record_counter + rec + 1` and nothing else,
so a file with a constant counter collides there outright. The spec asks for
much the same thing:

> When read names are not preserved the CRAM decoder should generate names,
> typically based on the file name and a numeric ID of the read using the record
> counter field of the slice header block.

The same question therefore reaches read names here, because those synthetic
names are built out of `uniqueId` — see the second half of the decision.

## Decision

**Keep the formula, for the file offset rather than for the counter.** The two
terms fail in opposite directions, and summing them means a file has to break
both to produce a collision:

- Slice header offsets **strictly increase** through the file, and the record
  counter is **non-decreasing**. With a counter the writer filled in correctly,
  slice _k+1_'s first id is `cp[k+1] + rc[k] + nr[k] + 1`, which is greater than
  the last id slice _k_ handed out. The ranges are disjoint and no argument
  about the counter is needed.
- With a counter that is constant — v1, or a writer that skipped it — the id
  degenerates to `contentPosition + 1 + i`, and slices collide only where one
  occupies fewer bytes on disk than it holds records.

Dropping the offset to match htslib exactly would buy read names that agree with
`samtools view`, and would cost the only fallback either case has. That is the
wrong trade for a reader, which does not get to choose its input files.

**Name a lossy mate group after the record holding the mate pointer.** A file
written with lossy read names stores no name for a mate group that fits inside
one slice, so `associateIntraSliceMate` invents one the group shares, from the
`uniqueId` of the record the walk reaches first. That is the same record htslib
names the group after, so the two disagree only by the offset term.

## Consequences

- A record's id is stable for a given file and derivable from the slice header
  alone, so a slice decoded in a worker needs nothing extra to produce it.
  Nothing about it is stable **across** files — two CRAMs will hand out the same
  ids, and a consumer holding both has to namespace them itself.
- The id is a `number` and travels in a `Float64Array` between the worker and
  the main thread, so it is exact only below 2^53. `contentPosition` is a byte
  offset and `recordCounter` a record index, so the sum stays six orders of
  magnitude under that on any real file; `test/uniqueId.test.ts` asserts it.
- Synthetic read names do not match `samtools view` on the same lossy-names
  file. htslib writes `<prefix>:<record_counter + rec + 1>`, this writes the
  decimal `uniqueId`, and the grouping is identical either way. The spec says
  "typically", so a name of our own is within it.
- A synthetic name could in principle collide with a stored one, since it
  carries no prefix to keep it out of the way. htslib's prefix exists for that;
  the collision needs a file that both drops some names and stores a decimal
  integer as another read's name, so it is not defended against here.

## Evidence

Measured across the CRAMs in `test/data` — samtools, htsjdk and scramble output,
v2.1 and v3.0, 348 slices and 126,260 records:

- **The record counter is sequential in every one.** Exactly one slice per file
  reports 0, the first, and every later slice reports the previous one's counter
  plus its record count — including the v2.1 files, whose spec calls the field
  1-based. Not one file in the corpus exercises the case the issue is about.
- **No id is handed out twice**, decoding every record of every file.
- **The narrowest slice spans 11.4 bytes per record** — 109,587 bytes over 9,596
  records, in `test-samtools-123.cram`. So even the degenerate fallback, with
  the counter contributing nothing, has an order of magnitude of headroom.

On the read names, `samtools view -C --output-fmt-option lossy_names=1` over a
mixed input — a pair, two single-end reads, and a read with a supplementary
alignment — drops the name of the pair alone and keeps the rest, and this
decoder reproduces that grouping exactly.

The walk had one hole, and it took a purpose-built file to reach it. Guarding
the naming on `if (!thisRecord.readName)` skipped the second link of an NF chain
longer than two, because the record holding that link had been named on the
previous iteration — so the far end of the chain came back with `readName`
undefined, which `IndexedCramFile` turns into a thrown `readName undefined`
under `viewAsPairs`. Reading the name off `thisRecord` instead of testing it
carries it the whole way down.

`ce#lossy3seg.cram` is that file, and htslib writes it: three segments of one
template, names dropped, chained `0 -> 1 -> 2`. Decoded against it, the third
record's name is `undefined` before the change and the head's uniqueId after.
`scripts/make-lossy-chain-fixture.ts` has the five constraints htslib imposes
before it will leave all three attached — the ordinary way to write a
three-segment template detaches the middle record instead, which is why none of
the other 131 fixtures produces such a chain and why all 126,260 of their
records decoded with a name either way.

Worth knowing when comparing against `samtools view`: htslib's own decode of
that file does **not** give the group one name. It reads back as `<file>:1`,
`<file>:2`, `<file>:1`, because htslib names a record after its mate line only
where that line points backwards, and the middle record's points forwards. One
name for one template is what the mate-pairing code here needs, so this decoder
differs on purpose.
