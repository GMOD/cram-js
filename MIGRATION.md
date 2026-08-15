# Migration

Every breaking change back to v9, newest first. If you are coming from several
majors back, read down — a later entry can supersede an earlier one, and where
it does the earlier entry says so.

All coordinates are 0-based half-open.

## v12 → v13: the mismatch window is half-open, and positions take an `origin`

`getMismatches(opts)` and `forEachMismatch(cb, opts)` took a window that was
**closed at both ends** — a difference exactly at `end` was reported — where
every other range in this library is 0-based half-open. It is now half-open too:

```js
// before (≤ 12): reports a substitution at exactly 120
record.getMismatches({ start: 100, end: 120 })

// now (13): 120 is outside [100, 120)
record.getMismatches({ start: 100, end: 121 })
```

If you were passing a half-open viewport and subtracting 1 to compensate, drop
the subtraction. If you were passing a closed range, add 1 to `end`. Nothing
else about which differences are reported has changed, and a spanning deletion
still counts as touching the window if any of its bases do.

New in the same options object: **`origin`**, which the reported positions are
relative to. `origin: record.start` gives read-relative positions, and 0 — the
default — gives reference ones:

```js
record.forEachMismatch(cb, { start, end, origin: record.start })
```

The window stays in reference coordinates while the output moves, so a consumer
working in read-relative space can still clip to a genomic viewport without
converting either one. It exists so such a consumer can hand its own callback
straight to the walk: converting afterwards costs an extra indirect call per
difference, which measured **+17%** on jbrowse's plotting path. See
[ADR 0008](docs/adr/0008-emit-into-the-consumers-callback.md).

## v11 → v12: `record.tags` is a column, and `getTag` reads one tag

Tags now live in a per-slice `TagColumn` rather than a `Record` per record, in
the same shape `readFeatureArena` uses: `record.tagStart`/`tagCount` name a run
of slots.

**`record.tags` still works and returns the same object it always did**, built
from the column on first access and then cached. Nothing has to change to keep
reading it. Two things do change:

- **Prefer `record.getTag(name)` for a single tag.** It reads the record's own
  slots instead of building an object holding every tag on the read, which
  measures 3.8–7.8x faster. `@gmod/bam` has had the same method for the same
  reason.
- **`tags` is now read-only.** It was a writable field; it is now a getter, and
  assigning to it throws a `TypeError` explaining what to do instead. If you
  were mutating it, build a `TagColumn` and pass it as `tagColumn` with
  `tagStart`/`tagCount`. Reading, spreading and `Object.keys` are unaffected —
  but note `tags` is no longer an _own_ enumerable property, so `{ ...record }`
  no longer carries it (`{ ...record.tags }` does, and `toJSON()` is unchanged).

`TagColumn`, `TagValue` and the `TAG_*` kind constants are exported from the
package root for consumers reading the columns directly.

## v11 → v12: `record.mate` is two numbers named for the next segment

`CramRecord.mate` is gone, along with the `MateRecord` type it was declared with
(that type was never re-exported from the package root, so only a deep import
could have named it). What is left of it — the position — sits directly on the
record, under SAM's names for those fields rather than this library's:

| before (≤ 11)            | now (12)                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `record.mate`            | `record.hasNextPosition()`                                                                |
| `record.mate.sequenceId` | `record.nextSequenceId` (SAM `RNEXT`, CRAM `NS`)                                          |
| `record.mate.start`      | `record.nextStart` (SAM `PNEXT`, CRAM `NP`)                                               |
| `record.mate.readName`   | gone — the two mates of a pair share a name, so use `record.readName`                     |
| `record.mate.flags`      | gone — already folded into `record.flags` as `BAM_FMUNMAP`/`BAM_FMREVERSE` while decoding |
| `record.mate.uniqueId`   | gone                                                                                      |

`toJSON()` follows: its `mate` key is replaced by `nextSequenceId` and
`nextStart`, present only when `hasNextPosition()`.

The `next*` naming matches SAM, BAM and `@gmod/bam`, which all call these fields
`RNEXT`/`PNEXT`, and CRAM's own `NS`/`NP` ("**next** fragment"). Note SAM splits
the vocabulary and so does this library: the _flag_ accessors keep the mate
wording, so `isMateUnmapped()` and `isMateReverseComplemented()` are unchanged.

Migrating:

- **Test `hasNextPosition()`, not truthiness of a field, and not `< 0`.**
  `nextSequenceId` is `NEXT_UNKNOWN` (`-2`, exported) when the file did not give
  a position, which is deliberately distinct from `-1` — a next segment that has
  a position but is unplaced, as a paired read with an unmapped mate decodes to
  (`NS = -1`). `getPairOrientation()` compares `-1` as a real value but falls
  back to the read1-first rule for `NEXT_UNKNOWN`, so both halves of such a pair
  still agree on their orientation; conflating the two makes them disagree.
- `hasNextPosition()` is **not** "does this read have a mate" — that is
  `isPaired()`. A paired read whose mate this file does not locate returns
  `false`.
- The three dropped fields were written on every paired record and read by
  nothing, in this library or in jbrowse.

Why: the object cost an allocation per paired record — ~150k on a 19 kb query
against 1000x-coverage short reads — and gave every record a reference to its
mate, which pinned whole slices in the record cache. Two numbers also cross a
worker boundary, which an object graph cannot; that is what this unblocks.

## v10 → v11: `featureCache` is a `SharedReadCache`

`CramFile.featureCache` is a `SharedReadCache` from `@gmod/shared-read-cache`
rather than this package's own `SliceRecordCache`. The field is public, so a
consumer reaching into it — shedding memory under pressure is the usual reason —
has to be updated:

| before (≤ 10)               | now (11)                      |
| --------------------------- | ----------------------------- |
| `featureCache.getOrFill(…)` | `featureCache.get(…)`         |
| `featureCache.get(…)`       | `featureCache.getIfCached(…)` |
| `featureCache.maxRecords`   | `featureCache.maxSize`        |

Behaviour is unchanged by the swap itself; cram was the third of the four gmod
packages to stop carrying its own copy of this cache. If all you do is construct
a `CramFile` and read records, nothing changes.

Two things did change inside v11, both non-breaking but worth knowing when you
arrive from v10:

- **`cacheSize` defaults to 1,000,000 records, up from 20,000.** The old default
  sat below the working set of a single query, so it cached nothing while
  retaining the memory anyway — see
  [ADR 0004](docs/adr/0004-size-the-slice-cache-above-one-query.md). If you set
  `cacheSize` yourself, it is now a real bound and is enforced as one
  ([ADR 0005](docs/adr/0005-drop-the-batch-eviction-policy.md)).
- **An idle cache reclaims itself** after `cacheIdleTimeoutMs` (default 3
  minutes), and `clearFeatureCache()` empties it on demand. Several `CramFile`s
  can share one ceiling by passing the same `cacheBudget`.

## v9 → v10: coordinates are 0-based half-open

Every coordinate this library hands out or takes in is **0-based half-open**.
Before v10 they were 1-based closed, which propagated a serialization detail of
the CRAM spec into the in-memory API. htslib does the opposite —
`bam1_core_t.pos` is 0-based in memory even though SAM text is 1-based — and
`@gmod/bam` was already 0-based, so the two libraries disagreed. They no longer
do.

What changed:

| before (≤ 9)                                        | now (10)                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `record.alignmentStart` (1-based)                   | `record.start` (0-based)                                         |
| `record.mate.alignmentStart`                        | `record.nextStart` (was `record.mate.start` in 10–11; see above) |
| `seqFetch(id, start, end)` 1-based closed           | `fetchReferenceSequence(id, start, end)` half-open               |
| `getRecordsForRange(id, start, end)` 1-based closed | 0-based half-open                                                |
| `readFeature.pos` / `.refPos` (1-based)             | 0-based                                                          |
| `Mismatch.refPos`, `forEachMismatch` opts           | 0-based half-open                                                |
| `CraiIndex` entry `.start` (1-based)                | 0-based                                                          |

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
  nothing. See [Unplaced reads](docs/api.md#unplaced-reads).

Converting back out to a 1-based text format (SAM `POS`, a locus string for a
user) means adding 1 — that is now the only place the conversion appears.

## v8 → v9: read features are columns, and mismatches have an API

Read features decode into a per-slice `ReadFeatureArena` of typed-array columns
at 19 bytes a feature, rather than an `{code, pos, refPos, data}` object per
feature at 64 (81 once substitutions were widened). That took a decoded ONT
slice from 20.41 MB to 7.42 MB.

`record.readFeatures` still reads the same: same shape, same values, the 189
dump snapshots untouched. But it is a **getter that rebuilds the array on each
access**, so:

- **Assigning to it throws.** Build records from plain features with
  `arenaFromReadFeatures()`, exported from the package root.
- **The array has no stable identity**, and mutating a feature you got from it
  writes into a throwaway object. Read in bulk through the columns instead.

Alongside it, `record.getMismatches(opts?)` and
`record.forEachMismatch(cb, opts?)` report the differences from the reference
(X/I/D/N/S/H) with an optional reference window. Prefer them: `readFeatures` was
the documented way to parse CRAM and it is too low level to use correctly.
Interpreting it means knowing that `i` and `I` are both insertions with
different payloads, that a run of `i` is one insertion, that `b` aligns as
matches, that an `X` feature's `data` is a substitution-matrix index rather than
a base, and that `q`/`Q` carry only quality — their `refPos` comes from a read
position the reference never reaches, so it can point backwards into an
insertion. Every one of those has been a bug in a downstream consumer.
`RF_POSITIONAL` marks which codes carry alignment geometry, for a consumer
walking the columns directly.

Also in v9: `getCigarString()` returns `'*'` rather than `''` for a mapped
record with no operations, which is what SAM and samtools spell.
