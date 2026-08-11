# 0008 — Emit into the consumer's callback, not into a translator

**Status:** accepted

## Context

[ADR 0006](0006-cigar-as-a-callback-walk.md) established the shape: this library
hands out a walk rather than an array, and the consumer's callback is called
once per item. It also established what that costs — **~15% of the walk, paid as
one indirect call per emission**, with no consumer-side trick that recovers it.

The corollary went unnoticed until jbrowse tried to adopt `forEachMismatch`. Its
own copy of the same walk — the duplicate `TODO.md` records — emits jbrowse's
vocabulary: small integer type constants rather than CRAM feature codes, and
read-relative positions rather than reference ones. So delegating to this
library meant putting a _translating_ callback between this walk and jbrowse's,
and paying ADR 0006's indirect call a second time.

Measured on the jbrowse side, one variant per process, fastest of 9: **266 ms →
312 ms** on 628 ONT reads (200x.longread) and **13.2 ms → 18.4 ms** on 80,177
short reads (200x.shortread) — **+17%**, on the walk that jbrowse's plotting
path runs per read per render. Emissions were identical, all 3,140,520 of them.
Folding the translation into dense lookup tables and a single call site changed
nothing, exactly as ADR 0006 found for `forEachCigarOp`.

**A library that can only be adopted by wrapping it has not really been
adopted.** The duplicate stays, and drifts — jbrowse's copy was silently
dropping `B` features, which this walk reports, for as long as it existed.

## Decision

Where a difference between the two vocabularies is a _coordinate convention_
rather than a meaning, this walk takes it as an option and applies it inline, so
the consumer's callback is the one it calls:

- **`MismatchOptions.origin`** — reported positions are relative to it,
  defaulting to 0. `origin: record.start` gives read-relative positions.
- **The window is now half-open**, `[start, end)`, like every other range this
  library takes. It was closed at both ends, which was a wart in its own right
  (recorded in `TODO.md`) and meant a caller with a half-open viewport had to
  pass `end - 1`.

The window stays in **reference** coordinates while the output moves to
`origin`, because the window describes a region of the reference rather than a
position in the output. That is what lets a read-relative consumer clip to a
genomic viewport without converting either one.

What is _not_ taken as an option: the vocabulary itself. `code` stays the CRAM
feature code, and a clip still reports `length` 0 and a deletion still reports
no bases. Those are meanings, not conventions, and a table of caller-supplied
substitutions for them would put a consumer's presentation choices inside a file
parser — which is what ADR 0006 declined and still declines.

## Consequences

- **Breaking**, hence 13.0.0. A caller passing `end` and expecting a difference
  exactly there to be reported now needs `end + 1`. Nothing else changes for a
  caller that does not pass `origin`.
- **`origin` is free.** The published 12.0.1 walk against this one, one variant
  per process, fastest of 9 on the same 628 ONT reads: **284.50 ms → 283.08
  ms**, with identical emission counts. It is one subtraction per emission
  against an argument that is 0 in the default case, inside a loop that already
  reads six columns.
- **It paid off, mostly.** jbrowse took it in
  `refactor(alignments): drive CRAM mismatches off @gmod/cram's own walk`,
  deleting its 110-line copy. Measured after the fact, interleaved and min of 13
  rounds: **1.047x and 1.066x** on 628 ONT reads, **1.046x and 1.119x** on
  80,177 short ones. So ~5% against the hand-inlined copy rather than the 17% a
  translator cost — the remainder is the walk living across a package boundary,
  and no option here can remove it.
- **A consumer should reuse its options object.** jbrowse allocates one
  module-level `{start, end, origin}` and mutates it per call: a fresh literal
  per read per render pass measured 16.5ms → 20.7ms on those 80,177 short reads,
  most of the cost of delegating at all. That is safe by construction here —
  `forEachMismatch` reads all three fields before the walk starts and retains
  none of them — and this ADR is where that guarantee lives, so do not start
  retaining the options object.
- The conventions jbrowse reconciled on its side, as predicted: its type
  constants are the CRAM feature codes now (it compared them symbolically
  everywhere, and none was serialized), and a clip's `length` is set in the one
  consumer that builds objects rather than per emission. The deletion and skip
  sentinels it used to emit — `'*'` and `'N'` where this walk reports no bases —
  turned out to be read by nothing at all.

## Evidence

Both figures above are one variant per process, alternating, fastest of 9, with
identity checked before timing — the method `docs/MEMORY.md` describes and the
traps ADR 0006 documents. The +17% was measured in jbrowse against its real call
site; the `origin` cost was measured here, against 12.0.1 extracted from its
published tarball rather than a second copy of this tree.

The equivalent BAM change is **not** available and is not planned: jbrowse's BAM
mismatch walk needs a reference sequence in jbrowse's own packed form, which a
BAM file does not carry, so it belongs where it is rather than in `@gmod/bam`.
This asymmetry is the same one ADR 0006 noted — CRAM threads the reference
through the decoder because reference compression requires it, and that is
precisely why this walk can live here at all.
