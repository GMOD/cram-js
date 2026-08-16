# 0011 — Derive `uniqueId` from the slice's file offset and the record counter

**Status:** accepted

## Context

Every record carries a `uniqueId` — JBrowse's feature id, and how
`IndexedCramFile` recognises a record it already collected when it goes back for
mates. It is `sliceHeader.contentPosition + recordCounter + 1 + i`.

[Issue #161](https://github.com/GMOD/cram-js/issues/161) asks whether the record
counter is the right field for that. `CRAMv3.tex` calls it a "0-based sequential
index of records in the file/stream", which says what a writer should write, not
what a reader may verify. Nothing makes the value unique, and checking it means
reading the whole file. CRAM v1 has no such field at all, so `readRecordCounter`
returns 0 for every slice in one.

That the definition itself moved argues for the same caution: `CRAMv2.1.tex`
calls the field 1-based, `CRAMv3.tex` 0-based, and every file in `test/data`
starts at 0 either way. The issue quotes the 1-based wording.

htslib takes the counter at its word — `cram_decode.c` builds synthetic read
names from `record_counter + rec + 1` alone, so a constant counter collides
there outright. The spec suggests as much: a decoder "should generate names,
typically based on the file name and a numeric ID of the read using the record
counter field". That reaches read names here too, since ours come from
`uniqueId`.

## Decision

**Keep the formula, for the offset rather than the counter.** The terms fail in
opposite directions, so a file has to break both to collide:

- Offsets strictly increase and the counter is non-decreasing, so with a correct
  counter slice _k+1_ starts above everything slice _k_ handed out. The ranges
  are disjoint without any argument about the counter.
- With a constant counter the id degenerates to `contentPosition + 1 + i`, which
  collides only where a slice occupies fewer bytes than it holds records.

Matching htslib exactly would buy read names that agree with `samtools view` and
cost the only fallback either case has — the wrong trade for a reader, which
does not choose its input files.

**Name a lossy mate group after the record holding the mate pointer**, the one
the walk reaches first. htslib names the group after the same record, so the two
differ only by the offset term.

**Every record decodes with a name**, and htslib's encoder makes that a property
rather than a hope: `add_read_names` stores a name for exactly the detached
records, and a record leaves the detached state only by becoming one end of an
NF link. So a nameless record is always on a chain the mate walk reaches, and
the walk must name all of it.

## Consequences

- The id is derivable from the slice header alone, so a worker needs nothing
  extra to produce it. It is not stable **across** files — two CRAMs hand out
  the same ids, and a consumer holding both must namespace them.
- It travels in a `Float64Array`, so it is exact only below 2^53. A byte offset
  plus a record index stays six orders of magnitude under that;
  `test/uniqueId.test.ts` asserts it.
- Synthetic names do not match `samtools view`: htslib writes
  `<prefix>:<record_counter + rec + 1>`, we write the decimal `uniqueId`. The
  grouping is identical, and the spec's "typically" leaves room for our own.
- A synthetic name could collide with a stored one, having no prefix to keep it
  clear. That needs a file which both drops names and stores a decimal integer
  as another read's name, so it is undefended.
- The walk now spreads a **stored** name to a mate the file left unnamed. htslib
  cannot write that pair — in lossy-name mode it detaches rather than link a
  named record to an unnamed one — so it covers only what another encoder might
  produce. It costs one `??`, the same one that carries a synthetic name down a
  chain.

## Evidence

Across `test/data` — samtools, htsjdk and scramble output, v2.1 and v3.0, 348
slices, 126,263 records:

- **The counter is sequential in every file**, v2.1 included. One slice per file
  reports 0, the first; every later one reports the previous counter plus its
  record count. No fixture exercises the case the issue is about.
- **No id is handed out twice**, decoding every record of every file.
- **The narrowest slice spans 11.4 bytes per record** — 109,587 over 9,596, in
  `test-samtools-123.cram`. Even the degenerate fallback has an order of
  magnitude of headroom.
- **Every record decodes with a name.** Reverting the mate-walk fix breaks
  exactly one, so the sweep discriminates rather than passing on everything.

`samtools view -C --output-fmt-option lossy_names=1` over a mixed input — a
pair, two single-end reads, a read with a supplementary alignment — drops the
pair's name and keeps the rest, which this decoder reproduces exactly.

The walk had one hole, and reaching it took a purpose-built file. Guarding the
naming on `if (!thisRecord.readName)` skipped the second link of an NF chain
longer than two, because that record had been named on the previous iteration —
so the far end came back `undefined`, which `IndexedCramFile` turns into a
thrown `readName undefined` under `viewAsPairs`. Reading the name off
`thisRecord` rather than testing it carries it the whole way down.

`ce#lossy3seg.cram` is that file, and htslib writes it: three segments, names
dropped, chained `0 -> 1 -> 2`. The third record's name is `undefined` before
the change, the head's uniqueId after. `scripts/make-lossy-chain-fixture.ts`
documents the constraints htslib imposes before leaving all three attached —
writing such a template the obvious way detaches the middle record instead,
which is why no other fixture produces one.

Worth knowing when diffing against `samtools view`: htslib's own decode of that
file reads back `:1`, `:2`, `:1`, because it names a record after its mate line
only where that line points backwards. One name per template is what the pairing
code here needs, so we differ deliberately.
