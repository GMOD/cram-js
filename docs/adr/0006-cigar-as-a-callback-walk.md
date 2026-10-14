# 0006 — Walk the CIGAR with a callback, not an array

**Status:** accepted

## Context

Unlike BAM, where the packed operation array is on disk and `@gmod/bam` can hand
out a zero-copy view of it, CRAM stores no CIGAR, so every CIGAR this library
produces is synthesized from read features. **Any array form is therefore an
allocation this library would add for every consumer**, rather than a view onto
something the file already contains.

The walk that synthesizes the CIGAR is the format's trickiest: features against
reference coordinates, insertions and soft clips consuming read bases,
substitutions that are matches as far as the CIGAR is concerned. It existed
twice — `getCigarString` here and jbrowse's 240-line
`readFeaturesToNumericCIGAR`, the latter with no samtools cross-check on the
side that shipped it.

## Decision

`CramRecord.forEachCigarOp(callback)` is the primitive. `getCigarString` renders
it to a string; jbrowse's `readFeaturesToNumericCIGAR` packs its `Uint32Array`
from it rather than re-walking the arena. This library offers no packed-array
API.

Alongside it, the library computes the two values the render path wants
directly, without a walk: `getLeadingClipLength()` and
`getTrailingClipLength()`.

## Consequences

**The callback costs ~15% of the CIGAR-building step**, and we accepted that
cost. We ran an A/B over decoded records, alternating, fastest-of-N, three
processes each, with an A-vs-A control to establish the noise floor:

| dataset           | records | ops       | control      | via `forEachCigarOp` |
| ----------------- | ------- | --------- | ------------ | -------------------- |
| longread 200x     | 628     | 4,452,662 | -1.4%..+1.4% | **+13.5%..+17.5%**   |
| SRR396637         | 54,695  | 69,837    | -0.8%..+2.8% | **+8.9%..+15.5%**    |
| SRR396636         | 23,051  | 33,793    | -0.6%..+5.1% | **+12.6%..+20.3%**   |
| ONT HG002 fixture | 37      | 244,795   | -1.2%..+2.1% | +10.9%..+13.8%       |

The cost is ~15% at _both_ ends of the read-length range rather than
concentrated at one. Long reads pay it per operation and short reads per call,
and the two come to the same fraction. In absolute terms it is ~10 ms on a ~70
ms pass over 628 long reads (~16 µs per read, which jbrowse then memoizes per
feature in its ultra-long LRU), and ~0.5 ms on a 3.5 ms pass over 54,695 short
ones. In exchange, jbrowse deleted its second implementation of that walk.

**The cost of the callback is not local**, which is a real constraint on the API
and not just on the benchmark. A second call site in the same process with a
differently-shaped callback makes the internal `callback(op, oplen)` sites
polymorphic and roughly _triples_ the penalty for the first. A consumer wanting
both a packer and, say, a clip-length walker should share one callback rather
than pass two.

**The render path stopped building a CIGAR at all.** The ~15% is the cost of
building the packed array, and the render path never needed the array:
`clipLengthAtStartOfRead` is the only CIGAR value the render path reads per
read, and that is a single operation — the first, or the last on the reverse
strand. jbrowse was manufacturing ~7,000 operations for a long ONT read, and
retaining them, to look at one. With the clip computed from
`CramRecord.getLeadingClipLength()` (and an allocation-free walk on the reverse
strand, ~50% of reads) the whole step became **faster than the array version it
replaced**:

| dataset       | records | vs. building the array |
| ------------- | ------- | ---------------------- |
| longread 200x | 628     | **-62%**               |
| ONT HG002     | 37      | **-62%**               |
| SRR396637     | 54,695  | **-45%**               |
| SRR396636     | 23,051  | **-46%**               |

The answers were identical on every record of every dataset, with the control
within ±3%. The callback's ~15% is now paid only by consumers that want the
packed form (per-base coloring, the details panel), and jbrowse's
`NUMERIC_CIGAR` is lazy for CRAM rather than built once per read on the render
path.

`getTrailingClipLength()` looked impossible at first: telling whether a trailing
clip is really the last _operation_ means knowing how many read bases come
before it, which seems to require replaying the whole walk. No replay is needed,
because the walk reaches each feature having emitted exactly `pos[i]` read
bases, so the total is `pos[last]` plus whatever the last feature consumes. We
checked that identity against the walk over ~82,000 records across every fixture
plus 628 long reads, 13,586 of them trailing-clipped. Those records include
`hard_clipping.cram`, the fixture originally cited as the counterexample. With
both ends computed directly, the step all but disappears: **-99.9%** on the
long-read set (148 ms to ~0.15 ms for 628 reads) and **-64%** on the short-read
files.

**The change altered the CIGAR of unmapped reads.** `forEachCigarOp` emits
nothing for an unmapped read, so jbrowse's `NUMERIC_CIGAR` is now empty where
the walk it replaced synthesized a full-length match run (190 of the ONT
fixture's records, 114 of SRR396637's). Empty is right: `getCigarString()` gives
`'*'`, the same value samtools prints, and `@gmod/bam`'s `_computeNumericCigar`
likewise returns an empty `Uint32Array` for `BAM_FUNMAP`. jbrowse's CRAM path
therefore now agrees with its BAM path.

**The mismatch walk has not moved into this library.** Moving one walk and not
the other looks arbitrary, but the CIGAR has a single spec-defined vocabulary
(the SAM op codes), so its walk could move in here without dragging any
consumer's render types along, whereas the mismatch walk emits jbrowse's own
vocabulary. See `TODO.md`.

## Evidence

We tried two changes, and neither recovered the ~15%:

- **Inlining the run coalescing** instead of factoring it into a `push(len, op)`
  closure. The inlining is worth keeping, and the code does it now. The closure
  has to capture and mutate `op`/`oplen`, so V8 allocates a context per call,
  which cost a further +40% on the short-read files (1.3 ops per record, so
  per-call cost dominates) and +10% on the long-read ones.
- **Hoisting the consumer's callback** to a module-level singleton writing into
  a swapped-in target array, so the walk allocates nothing per record. It
  measured indistinguishable from the per-call arrow. The remaining cost is the
  indirect call per operation, not allocation. A consumer therefore cannot
  recover it, and a packed-array API would be the only way.

Two mistakes in measuring the cost each produced confidently wrong numbers:

- **Do not measure this with two consumers in one process.** The first version
  of this benchmark ran `packCigar` _and_ a hoisted-callback variant in the same
  process and reported **+40%..+60%**. That was the polymorphism described
  above, not the callback. With a single consumer, which is what jbrowse has,
  the cost is the ~15% in the table.
- **Use a real long-read dataset.** The checked-in ONT fixture is **37
  records**, too few to time stably; its control swung 23 points before the
  polymorphism was fixed. `~/src/jb2bench` has `200x.longread.cram` (36 MB,
  `hg19mod.fa` alongside it); the region `0..120000` gives 628 records, 3.1M
  read features, 4.45M CIGAR ops and a median read length of 49 kb, and its
  control holds to ±1.4%. The file is too big to check in, but any claim about
  long-read CIGAR cost needs data like it.

  The long-read dataset is worth as much for correctness as for timing. The
  benchmark compares the two walks op-for-op before it times anything, and over
  those 4.45M operations they agree **exactly** (no unmapped reads in the region
  to hit the intended difference above). That cross-check covers far more of the
  walk than the checked-in fixtures do.

Revisit only with an end-to-end jbrowse render measurement showing the callback
matters there — the micro-benchmark above deliberately isolates the walk from
everything else a render does per read.
