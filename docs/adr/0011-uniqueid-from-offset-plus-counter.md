# 0011 — Derive `uniqueId` from the slice's file offset and the record counter

**Status:** accepted

## Context

Every record has a `uniqueId`. It is JBrowse's feature id, and `IndexedCramFile`
uses it to recognise a record it already collected when it goes back for mates.
The id is `sliceHeader.contentPosition + recordCounter + 1 + i`.

[Issue #161](https://github.com/GMOD/cram-js/issues/161) asks whether the record
counter is the right field for that. `CRAMv3.tex` calls it a "0-based sequential
index of records in the file/stream", which says what a writer should write, not
what a reader may verify. The format does not guarantee the value is unique, and
checking it means reading the whole file. CRAM v1 has no such field at all,
which is moot here only because this library refuses v1 files outright.

The definition itself changed between versions, which is another reason for
caution: `CRAMv2.1.tex` calls the field 1-based (the wording the issue quotes),
`CRAMv3.tex` 0-based, and every file in `test/data` starts at 0 either way.

htslib trusts the counter. `cram_decode.c` builds synthetic read names from
`record_counter + rec + 1` alone, so a constant counter makes those names
collide. The spec suggests as much: a decoder "should generate names, typically
based on the file name and a numeric ID of the read using the record counter
field". The counter affects read names in this library too, since our synthetic
names come from `uniqueId`.

## Decision

**Keep the formula, for the offset rather than the counter.** The terms fail in
opposite directions, so a file has to break both to collide:

- Offsets strictly increase and the counter is non-decreasing, so with a correct
  counter slice _k+1_ starts above everything slice _k_ handed out. The ranges
  are disjoint without any argument about the counter.
- With a constant counter the id degenerates to `contentPosition + 1 + i`, which
  collides only where a slice occupies fewer bytes than it holds records.

Matching htslib exactly would give read names that agree with `samtools view`
and cost the only fallback either case has. That is the wrong trade for a
reader, which does not choose its input files.

**Name a lossy mate group after the record holding the mate pointer**, the one
the walk reaches first. htslib names the group after the same record, so the two
differ only by the offset term.

**Every record decodes with a name**, and htslib's encoder guarantees it:
`add_read_names` stores a name for exactly the detached records, and a record
leaves the detached state only by becoming one end of an NF link. A nameless
record is therefore always on a chain the mate walk reaches, and the walk must
name all of it.

## Consequences

- The id is derivable from the slice header alone, so a worker needs nothing
  extra to produce it. The id is not stable **across** files: two CRAMs hand out
  the same ids, and a consumer holding both must namespace them.
- The id is held in a `Float64Array`, so it is exact only below 2^53. A byte
  offset plus a record index stays six orders of magnitude under that;
  `test/uniqueId.test.ts` asserts it.
- Synthetic names do not match `samtools view`: htslib writes
  `<prefix>:<record_counter + rec + 1>`, we write the decimal `uniqueId`. The
  grouping is identical, and the spec's "typically" allows our scheme.
- A synthetic name has no prefix, so it could collide with a stored one. A
  collision needs a file that both drops names and stores a decimal integer as
  another read's name, so the decoder does not guard against it.
- The walk now spreads a **stored** name to a mate the file left unnamed. htslib
  cannot write that pair, because in lossy-name mode it detaches the records
  rather than link a named record to an unnamed one. The case therefore covers
  only what another encoder might produce. The fix costs one `??`, the same one
  that passes a synthetic name down a chain.

## Evidence

We decoded all of `test/data` (samtools, htsjdk and scramble output, v2.1 and
v3.0, 348 slices, 126,263 records):

- **The counter is sequential in every file**, v2.1 included. One slice per file
  reports 0, the first; every later one reports the previous counter plus its
  record count. No fixture exercises the case the issue is about.
- **The decoder hands out no id twice**, over every record of every file.
- **The narrowest slice spans 11.4 bytes per record** — 109,587 over 9,596, in
  `test-samtools-123.cram`. Even the degenerate fallback has an order of
  magnitude of headroom.
- **Every record decodes with a name.** Reverting the mate-walk fix breaks
  exactly one, so the sweep discriminates rather than passing on everything.

`samtools view -C --output-fmt-option lossy_names=1` over a mixed input — a
pair, two single-end reads, a read with a supplementary alignment — drops the
pair's name and keeps the rest, which this decoder reproduces exactly.

The walk had one bug, and only a purpose-built file reached it. Guarding the
naming on `if (!thisRecord.readName)` skipped the second link of an NF chain
longer than two, because that record had been named on the previous iteration.
The far end therefore came back `undefined`, which `IndexedCramFile` turns into
a thrown `readName undefined` under `viewAsPairs`. The fix reads the name off
`thisRecord` instead of testing it, which passes the name the whole way down the
chain.

`ce#lossy3seg.cram` is that file, and htslib writes it: three segments, names
dropped, chained `0 -> 1 -> 2`. The third record's name is `undefined` before
the change, the head's uniqueId after. `scripts/make-lossy-chain-fixture.ts`
documents the constraints htslib imposes before leaving all three attached.
Written the obvious way, such a template comes out with the middle record
detached, which is why no other fixture has a three-segment chain.

When you diff against `samtools view`, note that htslib's own decode of that
file reads back `:1`, `:2`, `:1`, because it names a record after its mate line
only where that line points backwards. The pairing code here needs one name per
template, so we differ deliberately.
