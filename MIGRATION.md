# Migration

## v11 → v12: `record.mate` is two numbers, not an object

`CramRecord.mate` is gone, along with the `MateRecord` type it was declared with
(that type was never re-exported from the package root, so only a deep import
could have named it). The mate's locus now lives directly on the record:

| before (≤ 11)            | now (12)                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `record.mate`            | `record.hasMate()`                                                                        |
| `record.mate.sequenceId` | `record.mateSequenceId`                                                                   |
| `record.mate.start`      | `record.mateStart`                                                                        |
| `record.mate.readName`   | gone — the two mates of a pair share a name, so use `record.readName`                     |
| `record.mate.flags`      | gone — already folded into `record.flags` as `BAM_FMUNMAP`/`BAM_FMREVERSE` while decoding |
| `record.mate.uniqueId`   | gone                                                                                      |

`toJSON()` follows: its `mate` key is replaced by `mateSequenceId` and
`mateStart`, present only when `hasMate()`.

Migrating:

- **Test `hasMate()`, not truthiness of a field.** `mateSequenceId` is `NO_MATE`
  (`-2`, exported) when there is no mate, which is deliberately distinct from
  `-1` — a mate that exists but is unplaced. A paired read whose mate is
  unmapped decodes with `NS = -1`, and `getPairOrientation()` has to tell that
  apart from "no mate known", which falls back to the read1-first rule.
  `record.mateSequenceId < 0` would conflate the two.
- The three dropped fields were written on every paired record and read by
  nothing, in this library or in jbrowse.

Why: the object cost an allocation per paired record — ~150k on a 19 kb query
against 1000x-coverage short reads — and gave every record a reference to its
mate, which pinned whole slices in the record cache. Two numbers also cross a
worker boundary, which an object graph cannot; that is what this unblocks.

## v9 → v10: coordinates are 0-based half-open

Every coordinate this library hands out or takes in is **0-based half-open**.
Before v10 they were 1-based closed, which propagated a serialization detail of
the CRAM spec into the in-memory API. htslib does the opposite —
`bam1_core_t.pos` is 0-based in memory even though SAM text is 1-based — and
`@gmod/bam` was already 0-based, so the two libraries disagreed. They no longer
do.

What changed:

| before (≤ 9)                                        | now (10)                                           |
| --------------------------------------------------- | -------------------------------------------------- |
| `record.alignmentStart` (1-based)                   | `record.start` (0-based)                           |
| `record.mate.alignmentStart`                        | `record.mate.start`                                |
| `seqFetch(id, start, end)` 1-based closed           | `fetchReferenceSequence(id, start, end)` half-open |
| `getRecordsForRange(id, start, end)` 1-based closed | 0-based half-open                                  |
| `readFeature.pos` / `.refPos` (1-based)             | 0-based                                            |
| `Mismatch.refPos`, `forEachMismatch` opts           | 0-based half-open                                  |
| `CraiIndex` entry `.start` (1-based)                | 0-based                                            |

Migrating:

- Rename `alignmentStart` to `start` and drop any `- 1` you were applying to it.
  The old name is gone rather than silently shifted, so this fails loudly.
- Rename the `seqFetch` constructor option to `fetchReferenceSequence` **and**
  change it to half-open. The rename is deliberate: a callback left on the old
  1-based contract would otherwise return bases shifted by one with nothing to
  catch it. With the rename, an unmigrated callback is simply never installed
  and the library throws "callback not provided".
- Half-open means the returned string must be exactly `end - start` characters —
  one fewer than before for the same region.
- Unplaced records now report `start` of `-1` rather than `0`, matching what BAM
  has always stored. If you fetch them, the query moves with them:
  `getRecordsForRange(-1, -1, end)`, not `(-1, 0, end)`, which now returns
  nothing. See [Unplaced reads](README.md#indexedcramfile).

Converting back out to a 1-based text format (SAM `POS`, a locus string for a
user) means adding 1 — that is now the only place the conversion appears.
