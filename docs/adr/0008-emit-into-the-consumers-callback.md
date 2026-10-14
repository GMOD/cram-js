# 0008 — Emit into the consumer's callback, not into a translator

**Status:** accepted

## Context

[ADR 0006](0006-cigar-as-a-callback-walk.md) established the pattern: this
library hands out a walk rather than an array, and the consumer's callback is
called once per item. It also established what that costs — **~15% of the walk,
paid as one indirect call per emission**, with no consumer-side trick that
recovers it.

The corollary went unnoticed until jbrowse tried to adopt `forEachMismatch`. Its
own copy of the same walk — the duplicate `TODO.md` records — emits jbrowse's
vocabulary: small integer type constants rather than CRAM feature codes, and
read-relative positions rather than reference ones. Delegating to this library
meant putting a _translating_ callback between this walk and jbrowse's, and
paying ADR 0006's indirect call a second time.

We measured on the jbrowse side, one variant per process, fastest of 9: **266 ms
→ 312 ms** on 628 ONT reads (200x.longread) and **13.2 ms → 18.4 ms** on 80,177
short reads (200x.shortread), **+17%**, on the walk that jbrowse's plotting path
runs per read per render. Emissions were identical, all 3,140,520 of them.
Folding the translation into dense lookup tables and a single call site changed
nothing, exactly as ADR 0006 found for `forEachCigarOp`.

**A consumer that can adopt the walk only by wrapping it keeps its own copy.**
That duplicate falls out of step: jbrowse's copy dropped `B` features, which
this walk reports, without any warning for as long as it existed.

## Decision

Where a difference between the two vocabularies is a _coordinate convention_
rather than a meaning, this walk takes it as an option and applies it inline,
calling only the consumer's own callback:

- **`MismatchOptions.origin`** — reported positions are relative to it,
  defaulting to 0. `origin: record.start` gives read-relative positions.
- **The window is now half-open**, `[start, end)`, like every other range this
  library takes. The window was closed at both ends, a flaw already recorded in
  `TODO.md`, and a caller with a half-open viewport had to pass `end - 1`.

The window stays in **reference** coordinates while the output moves to
`origin`, because the window describes a region of the reference rather than a
position in the output. That lets a read-relative consumer clip to a genomic
viewport without converting either one.

The walk does _not_ take the vocabulary itself as an option. `code` stays the
CRAM feature code, and a clip still reports `length` 0 and a deletion still
reports no bases. Those are meanings, not conventions, and a table of
caller-supplied substitutions for them would put a consumer's presentation
choices inside a file parser, which ADR 0006 declined and still declines.

## Consequences

- **The change is breaking**, hence 13.0.0. A caller passing `end` and expecting
  a difference exactly there to be reported now needs `end + 1`. For a caller
  that does not pass `origin`, that is the only change.
- **`origin` adds no measurable cost.** We compared the published 12.0.1 walk
  against this one, one variant per process, fastest of 9 on the same 628 ONT
  reads: **284.50 ms → 283.08 ms**, with identical emission counts. `origin`
  costs one subtraction per emission against an argument that is 0 in the
  default case, inside a loop that already reads six columns.
- **jbrowse adopted the walk** in
  `refactor(alignments): drive CRAM mismatches off @gmod/cram's own walk`,
  deleting its 110-line copy. We measured afterwards against that copy,
  interleaved, min of 13 rounds, **on a bundle**, which is the form jbrowse
  ships and the only honest way to measure this:

  | corpus             | delegating vs. the in-repo copy |
  | ------------------ | ------------------------------- |
  | 628 ONT reads      | 0.999x, 1.013x, 1.021x — parity |
  | 80,177 short reads | 1.088x, 1.111x, 1.132x — ~10%   |

  What remains is **one extra call per read**, not per emission: a consumer
  reaches the walk through `record.forEachMismatch`, which adds a call the
  consumer's copy did not make. A long read amortizes it over ~5,000 emissions
  and a short read has ~7, which is the entire difference between those two
  rows.

- **Do not measure this under node's ESM loader.** The same numbers taken
  unbundled show a further ~6% that a bundled consumer never pays: the
  _identical_ walk, moved to another module and changed in no other way,
  measured **1.065x unbundled and 0.993x bundled**. A module boundary costs
  something under the loader and nothing after a bundler has erased it. This
  measurement error is distinct from the two that ADR 0006 records, and it
  points the other way: here the naive harness made a real change look worse
  than it is.
- **A consumer should reuse its options object.** jbrowse allocates one
  module-level `{start, end, origin}` and mutates it per call: a fresh literal
  per read per render pass measured 16.5ms → 20.7ms on those 80,177 short reads,
  most of the cost of delegating at all. Reusing the object is safe, because
  `forEachMismatch` reads all three fields before the walk starts and retains
  none of them. This ADR records that guarantee, so do not start retaining the
  options object.
- jbrowse reconciled the other conventions on its side, as predicted. Its type
  constants are the CRAM feature codes now (it compared them symbolically
  everywhere, and none was serialized), and a clip's `length` is set in the one
  consumer that builds objects rather than per emission. The deletion and skip
  sentinels jbrowse used to emit, `'*'` and `'N'` where this walk reports no
  bases, turned out to be read by no code at all.

## Evidence

The +17% and the `origin` cost were measured one variant per process,
alternating, fastest of 9, with identity checked before timing — the method
`docs/memory.md` describes and the traps ADR 0006 documents. The +17% was
measured in jbrowse against its real call site; the `origin` cost here, against
12.0.1 from its published tarball rather than a second copy of this tree.

The after-the-fact figures in **Consequences** were taken differently, and the
difference matters. Separate processes could not resolve them: on a loaded box
the same comparison measured anywhere from 1.056x to 1.23x. Interleaving both
variants in one process — jbrowse's own harness design, in
`plugins/alignments/benches/mismatchWalk.bench.ts` — gave a ratio stable to
about ±2%, and is safe here because both variants drive the _same_ callback, so
neither walk's call site sees a second shape. Interleaving more than two
variants is not safe: a four-way run inflated every absolute number by 60% and
its ratios disagreed with the pairwise ones. Compare two things at a time.

The equivalent BAM change is **not** available and is not planned: jbrowse's BAM
mismatch walk needs a reference sequence in jbrowse's own packed form, which a
BAM file does not contain, so it belongs where it is rather than in `@gmod/bam`.
ADR 0006 noted the same asymmetry. CRAM threads the reference through the
decoder because reference compression requires it, which is why this walk
belongs in this library at all.
