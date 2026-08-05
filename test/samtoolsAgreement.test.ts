// Every indexed CRAM in test/data, queried against samtools.
//
// The unit tests elsewhere pin what this reader returns; this pins that it
// returns what htslib returns. Those are different claims, and only the second
// one catches a filter that is self-consistently wrong — which is how a
// one-base error at the left edge of every window survived a release.
//
// Two things have to agree, and they need different comparisons:
//
//   - the filter returns the right records. Regions are chosen to land exactly
//     on record edges rather than at round numbers, since that is where
//     inclusive/exclusive mistakes live, and each is compared over the full
//     result set, so it catches a record wrongly included as readily as one
//     wrongly dropped.
//   - each record decodes to the right alignment. Identity says nothing about
//     CIGAR, MAPQ, TLEN, SEQ or QUAL, and CRAM stores none of the first or the
//     fourth — the CIGAR is rebuilt from read features and the bases from those
//     plus the reference — so those are compared too, once per reference over
//     all of it rather than once per window.
//
// Most fixtures come from the htslib suite and name their reference in the
// filename (`ce#tag_padded.tmp.cram` -> `ce.fa`), which is enough for both
// sides to decode fully and for either comparison. The rest reference a FASTA
// that is not in this repo; those are still compared, but on record count
// alone, which an off-by-one at a window edge still moves.
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'
import {
  alignments,
  boundaryWindows,
  count as samtoolsCount,
  qualString,
  records as samtoolsRecords,
  references,
  refsWithRecords,
  samFields,
  samtoolsAvailable,
  samtoolsVersion,
  sortedness,
} from './lib/samtools.ts'
import { testDataFile } from './lib/util.ts'

const DATA = 'test/data'

const indexedCrams = readdirSync(DATA)
  .filter(f => f.endsWith('.cram'))
  .filter(f => existsSync(`${DATA}/${f}.crai`))
  .sort()

/** htslib fixtures are named `<reference>#<case>.cram`. */
function referenceFor(name: string) {
  const fa = `${name.split('#')[0]!.replace(/\.cram$/, '')}.fa`
  return existsSync(`${DATA}/${fa}`) ? fa : undefined
}

const available = samtoolsAvailable()
let identityComparisons = 0
let countComparisons = 0
let decodeComparisons = 0
const skipped: string[] = []

describe.skipIf(!available)(
  `agreement with ${available ? samtoolsVersion() : 'samtools'}`,
  () => {
    test.each(indexedCrams)(
      '%s matches samtools',
      async name => {
        const path = `${DATA}/${name}`
        const fa = referenceFor(name)
        const extra = fa ? ['-T', `${DATA}/${fa}`] : []

        // With the real reference, samtools decodes fully and we can compare
        // identities and alignments. Without it, it will still count records
        // but not emit them, so those files are held to the weaker check — and
        // this side has no bases to reconstruct from either, so the stub only
        // has to be the length the decoder asked for. Coordinates are 0-based
        // half-open, so that length is `end - start`.
        const fasta = fa ? new FetchableSmallFasta(testDataFile(fa)) : undefined
        const fetchReferenceSequence = fasta
          ? fasta.fetch.bind(fasta)
          : async (_id: number, start: number, end: number) =>
              'A'.repeat(end - start)

        const open = () =>
          new IndexedCramFile({
            cramFilehandle: testDataFile(name),
            index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
            fetchReferenceSequence,
            // positions do not depend on the reference matching, and several
            // fixtures carry an M5 for a FASTA this repo does not ship
            checkSequenceMD5: false,
          })

        const refs = references(path, extra)
        if (!refs) {
          // samtools will not read this fixture, so it cannot arbitrate it
          skipped.push(name)
          return
        }
        // Only an optimisation — it keeps a 3316-reference header from
        // querying 3316 empty references — and `idxstats` refuses outright on
        // a file that is not position sorted, which several of these
        // deliberately are not. Walk the header when it will not answer.
        const present = refsWithRecords(path)
        // One pass for the whole file rather than one per reference, and only
        // where samtools can decode it: without a reference it cannot emit
        // records at all, so the scan would be a guaranteed-failing full
        // decode of every container.
        const sorted = fa ? sortedness(path, extra) : undefined
        // one reader for the whole file: re-opening per window would discard
        // its caches and turn this into a decompression benchmark
        const cram = open()

        for (const ref of refs.filter(r => !present || present.has(r.name))) {
          let all
          try {
            all = await cram.getRecordsForRange(ref.id, 0, ref.length)
          } catch {
            // a fixture this reader rejects on purpose; its own unit test owns
            // that behaviour, and samtools cannot arbitrate what never parsed
            skipped.push(`${name}:${ref.name}`)
            continue
          }
          if (all.length === 0) {
            continue
          }

          // Judged from the file's own record order rather than from @HD,
          // which these fixtures do not carry. See sortedness().
          //
          // Only the window comparisons go: htslib's region iterator is what
          // assumes coordinate order, so it cannot arbitrate a query on one of
          // these. The decode comparison below still can, reading the file
          // linearly instead — and these are the fixtures that exist to
          // exercise template length, so it is the one worth keeping.
          const unsorted = sorted?.get(ref.name) === false
          if (unsorted) {
            skipped.push(`${name}:${ref.name} (not coordinate sorted)`)
          }

          const spans = all.map(r => ({
            start: r.start,
            end: r.start + (r.lengthOnRef || 1),
          }))

          for (const [min, max] of unsorted
            ? []
            : boundaryWindows(spans, ref.length)) {
            const mine = await cram.getRecordsForRange(ref.id, min, max)
            const where = `${name} ${ref.name}:${min}-${max} (0-based, half-open)`

            if (fa) {
              const ours = mine
                .map(r => `${r.readName}|${r.flags}|${r.start + 1}`)
                .sort()
              const theirs = samtoolsRecords(
                path,
                ref.name,
                min,
                max,
                extra,
              ).sort()
              identityComparisons++
              expect({ where, records: ours }).toStrictEqual({
                where,
                records: theirs,
              })
            } else {
              countComparisons++
              expect({ where, n: mine.length }).toStrictEqual({
                where,
                n: samtoolsCount(path, ref.name, min, max, extra),
              })
            }
          }

          if (!fa) {
            continue
          }
          // The same records again, this time on what each one decoded to.
          // MAPQ is spelled back as the 0 htslib prints for a record that
          // stores none, which CRAM does for every unmapped read.
          //
          // xx#repeated gives its three pairs one read name between them, and
          // stores no TS for any of them, so both implementations have to
          // work the template length out from the mate chain. Neither is
          // reading the file wrong; they resolve an ambiguous chain
          // differently, and htslib's own answer is not consistent across the
          // three — it reports +20 for the first S/67 at position 1 and -20
          // for the other two, which are the same record. Compare everything
          // else about them.
          const dropTlen = name.startsWith('xx#repeated')
          const where = `${name}:${ref.name}`
          const decoded = all
            .map(r =>
              samFields(
                [
                  r.readName,
                  r.flags,
                  r.start + 1,
                  r.getCigarString(),
                  r.mappingQuality ?? 0,
                  r.templateLength ?? r.templateSize ?? 0,
                  r.getReadBases(),
                  qualString(r.qualityScores),
                ],
                dropTlen,
              ),
            )
            .sort()
          decodeComparisons += decoded.length
          expect({ where, alignments: decoded }).toStrictEqual({
            where,
            alignments: alignments(path, ref.name, extra, {
              scan: unsorted,
              dropTlen,
            }),
          })
        }
      },
      180_000,
    )

    // A run where every file quietly errored out, or where the region generator
    // stopped producing windows, would otherwise pass while checking nothing.
    test('covers enough of the corpus to be meaningful', () => {
      if (skipped.length) {
        console.warn(`no window comparison: ${skipped.join(', ')}`)
      }
      expect(indexedCrams.length).toBeGreaterThanOrEqual(40)
      expect(identityComparisons).toBeGreaterThanOrEqual(100)
      expect(countComparisons).toBeGreaterThanOrEqual(20)
      // Also the guard on the reference actually arriving: with no reference
      // there are no bases to reconstruct, so a fetch callback that is quietly
      // ignored — as `seqFetch` was, having been renamed in v10 — turns every
      // SEQ in this comparison into `*` and fails it.
      expect(decodeComparisons).toBeGreaterThanOrEqual(1000)
    })
  },
)

// The coverage guard above lives inside the skipIf'd describe, so it skips
// along with the suite and cannot report its own absence: with samtools
// missing, every case here silently passes by not running. CI installs it, and
// this fails loudly if that ever stops being true.
test.skipIf(!process.env.CI)('samtools is installed in CI', () => {
  expect(available).toBe(true)
})
