# 0002 — Batch per-record work rather than defer it behind a getter

**Status:** accepted

## Context

Decoding a slice used to make one `TextDecoder.decode` call per read name and
one per Z tag value — 110,048 calls for the 54,695 records of SRR396637.
`TextDecoder`'s per-call overhead is most of what a 20-character read name
costs, so this was ~10% of the decode spent on call setup rather than on bytes.

The obvious fix is to make the field lazy, and jbrowse's access pattern favors
it. jbrowse reaches `record.readName` only through `CramSlightlyLazyFeature`'s
`name` getter, and the only callers of `get('name')` on the CRAM path are
chained/paired mode (`chainGroupingKey`), the details panel
(`buildBaseFeatureData`), the context menu, the read-vs-ref dialog and SAM
export. **A plain pileup render never asks for a read name at all**, so with a
deferred name the most common render would never decode one.

The alternative uses the block layout, which already suits bulk decoding.
`byteArrayStop` stores its values end to end, each followed by its stop byte, so
the block holds the strings in order and one `TextDecoder` call decodes all of
them.

## Decision

**Batch it.** `CramCodec.bindStringReader` (ADR
[0001](0001-codec-binding-seam.md)) decodes the block once on the first read,
then answers each read with `indexOf(stopChar)` and a `slice` from the cursor's
position. `readName` stays an ordinary field, assigned during the slice decode.

Two details keep the batched read correct:

- **Read from the cursor, not from a precomputed table.** The reader keeps no
  index that could fall out of step, so a block shared with another codec, or a
  caller that skips a value, stays correct with no bookkeeping.
- **Check that byte offsets are character offsets, once.**
  `block.length === content.length` holds exactly when every byte decoded to one
  character, because UTF-8 never yields more UTF-16 units than bytes and
  equality therefore forces the 1:1 case. Read names and Z tag values are ASCII
  by spec; anything else — a multi-byte sequence, a BOM — fails the check and
  falls through to decoding per value.

The two string kinds are delimited differently and one expression covers both.
CRAM ends a read name _with_ the NUL, and delimits a Z tag value with a **tab**
while keeping BAM's trailing NUL inside the value. The reader therefore cuts at
the stop byte, and if the character before it is a NUL, cuts at the first NUL
instead. A read name never has a NUL before its delimiter, so the same
expression handles it unchanged.

## Consequences

- `TextDecoder` calls decoding SRR396637 went **110,048 → 240** — six slices
  times two blocks, plus the header. That count is exact and independent of
  machine load, so it is a more reliable measure than any timing on a shared
  machine.
- The API is unchanged. There is no getter, no offset field beside every name,
  and no special handling for `mate.readName` or for the assignment in
  `addReferenceSequence`.
- **Batching costs retained heap**, which is the trade this ADR accepts. A name
  is now a slice of the decoded block: 54,695 of them are ~1.31 MB of 24-byte
  slice headers plus the 1.14 MB block they point into, against ~1.75 MB of
  standalone strings. On SRR396637 the retained heap went 30.68 MB → 31.37 MB,
  +2.3%. **V8 keeps a slice's whole block alive as long as any record from it
  lives**, which shows only when a consumer holds on to one record from a query.
  Interning the names recovers that heap and more (29.49 MB, below the figure
  before this work) but costs 10–20% of the decode, so we tried it and reverted
  it; see [ADR 0007](0007-optimizations-measured-and-rejected.md) for the
  numbers and for why hashing a string cannot be cheaper than slicing one.
  - Tag values mostly avoid this cost, because V8 copies a slice shorter than 13
    characters instead of pointing into the parent. Short values therefore hold
    no reference to the block, and the GC collects it after the decode. Adding Z
    tags cost only a further +0.18 MB.
- After batching, deferring the read name would save ~1.4% of the decode, at the
  price of turning a plain field into a getter. We therefore decided against
  deferring it instead of leaving the idea open; see also
  [ADR 0007](0007-optimizations-measured-and-rejected.md), which lists the other
  optimizations we measured and did not take.

## Evidence

Decoded in isolation, SRR396637's 54,695 read names take **10.4 ms** one at a
time and **1.5 ms** as one block, so 86% of the cost was per-call overhead.

We measured end to end against the tree before this work, over 14 paired rounds
with the min of 8 decodes per round. A second extraction of the baseline ran as
an A-vs-A control, and the running order rotated each round so that a machine
drifting quieter cannot favor whichever tree runs last:

| dataset                | effect (mean / median) | faster in | control "faster" in |
| ---------------------- | ---------------------- | --------- | ------------------- |
| jb2bench 1000x SR      | +28.1% / +28.3%        | **14/14** | 6/14                |
| jb2bench 200x SR       | +26.2% / +27.4%        | **14/14** | 7/14                |
| SRR396637              | +21.2% / +28.7%        | 12/14     | 8/14                |
| HG002 ONT (37 records) | not separable          | 5/14      | 5/14                |

Those figures include ADR 0001's `bindUintReader` work, which was merged in the
same sequence. ONT is the null case by construction, since 37 records have only
37 names, and it measures as a null case. That result shows the harness is not
simply rewarding whichever tree ran second. An earlier harness that ran the
baseline first every round reported +7% on ONT; rotating the order removed it.

The **win rates** in this table do not depend on machine load, and the
percentages do. The machine had a load average between 4 and 17 across these
runs, so treat the sd column in the raw results as the real precision. Output
was byte-identical across all 51 indexed fixtures — `toJSON`, CIGAR, read bases,
mismatches, `readName` and `mate.readName` over 91,381 records, against a
soft-masked reference.
