# Migration

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
