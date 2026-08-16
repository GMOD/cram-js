# Raw read features

A CRAM record doesn't store an aligned sequence. What it stores is a list of
_read features_: the handful of places where the read departs from the
reference, plus a few housekeeping entries. `getReadBases()`, `getCigarString()`
and `getMismatches()` are all reconstructed from that list.

You can get at the list directly, as `record.readFeatures`. Everything you have
to know before you do is below.

## You probably don't need this

`getMismatches()` already reports every feature that represents a difference
from the reference: substitutions, insertions (under either encoding),
deletions, reference skips, and soft and hard clips. So if differences are what
you're after, that function is the whole story — see
[What to ask a record](../README.md#what-to-ask-a-record).

`B` and `b` both store bases verbatim rather than as substitutions, and both are
still reported — as substitutions — for whichever of their bases disagree with
the reference. That needs a reference, so with no `fetchReferenceSequence` they
report nothing at all.

What it deliberately leaves out, because neither is a difference:

| Code     | What it carries                                       |
| -------- | ----------------------------------------------------- |
| `q`, `Q` | quality scores, which say nothing about the alignment |
| `P`      | padding, which consumes neither read nor reference    |

Wanting one of those is the honest reason to walk the raw list. If that's you,
read the next section carefully.

## Traps

Every one of these has been a real bug in code that walked the features itself:

- `i` and `I` are both insertions, and they store their payload differently.
- A run of `i` features is _one_ insertion, not several.
- `b` carries a run of bases that align as CIGAR matches, but they are not all
  matches: htslib writes `b` only when encoding with no reference
  (`samtools view --output-fmt-option no_ref`, and every CRAM `samtools depad`
  writes), so the writer computed no substitutions and the run covers real ones.
  Diff it against a reference of your own — `getMismatches()` does.
- `q` and `Q` carry only quality. Their `refPos` isn't an alignment position at
  all, so a positional walk has to skip them. `RF_POSITIONAL[code]` is 0 for
  exactly those two, which is the cheapest way to test for them.
- An `X` feature's `data` is an index into the container's substitution matrix,
  not a base.

## Fields

Each entry in `record.readFeatures` (CRAM spec §10.2) has:

- `code` — feature type, one of `bqBXIDiQNSPH`
- `pos` — read position (0-based)
- `refPos` — reference position (0-based), except for `q` and `Q`. Those two
  derive `refPos` from a read position the reference never reaches, so it can
  point backwards into an insertion.
- `data` — the payload, which differs per code (see below)
- `ref` / `sub` — reference and substituted base, for code `X` only. They only
  show up once a reference has been applied, which means when
  `fetchReferenceSequence` is configured.

### `data` by feature code

| Code(s)            | `data`                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `I`, `S`, `b`, `i` | the inserted, clipped or verbatim bases, as a string. That includes `i`, which is a single-base insertion and does store its base |
| `D`, `N`, `H`, `P` | the deleted, skipped, clipped or padded length, as a number                                                                       |
| `Q`                | the quality score                                                                                                                 |
| `q`                | an array of quality scores                                                                                                        |
| `B`                | `[base, quality]`                                                                                                                 |
| `X`                | an index into the container's substitution matrix, **not** a base                                                                 |

## Reading them without the allocation

`record.readFeatures` rebuilds the whole array from columnar storage every time
you touch it, so pull it into a local rather than reading it in a loop
condition.

If you're processing records in bulk and that still costs too much, the columns
themselves are public: `readFeatureArena`, `readFeatureStart` and
`readFeatureCount`, shared across every record in a slice. Reading those instead
of `readFeatures` measured 3.7x faster on a long-read slice, at a fraction of
the memory. `forEachMismatch()` is built on them and is a good model to crib
from.
