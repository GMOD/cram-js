// Every indexed CRAM in test/data, queried against samtools.
//
// The unit tests elsewhere pin what this reader returns; this pins that it
// returns what htslib returns. Those are different claims, and only the second
// one catches a filter that is self-consistently wrong — which is how a
// one-base error at the left edge of every window survived a release.
//
// Regions are chosen to land exactly on record edges rather than at round
// numbers, since that is where inclusive/exclusive mistakes live. The
// comparison at each region covers the full result set, so it catches a record
// wrongly included as readily as one wrongly dropped.
//
// Most fixtures come from the htslib suite and name their reference in the
// filename (`ce#tag_padded.tmp.cram` -> `ce.fa`), which is enough for samtools
// to decode them and for a name/flag/position comparison. The rest reference a
// FASTA that is not in this repo; those are still compared, but on record count
// alone, which an off-by-one at a window edge still moves.
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { CraiIndex, IndexedCramFile } from '../src/index.ts'
import { FetchableSmallFasta } from './lib/fasta/index.ts'
import {
  boundaryWindows,
  count as samtoolsCount,
  records as samtoolsRecords,
  references,
  samtoolsAvailable,
  samtoolsVersion,
  scanRef,
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
        // identities. Without it, it will still count records but not emit
        // them, so those files are held to the weaker check.
        const fasta = fa
          ? new FetchableSmallFasta(testDataFile(fa))
          : undefined
        const seqFetch = fasta
          ? fasta.fetch.bind(fasta)
          : async (_id: number, start: number, end: number) =>
              'A'.repeat(end - start + 1)

        const open = () =>
          new IndexedCramFile({
            cramFilehandle: testDataFile(name),
            index: new CraiIndex({ filehandle: testDataFile(`${name}.crai`) }),
            seqFetch,
            // positions do not depend on the reference matching, and several
            // fixtures carry an M5 for a FASTA this repo does not ship
            checkSequenceMD5: false,
          })

        const refs = references(path, extra)
        if (!refs) {
          skipped.push(name)
          return
        }

        for (const ref of refs) {
          let all
          try {
            all = await open().getRecordsForRange(ref.id, 0, ref.length)
          } catch {
            // a fixture this reader rejects on purpose; its own unit test owns
            // that behaviour, and samtools cannot arbitrate what never parsed
            skipped.push(`${name}:${ref.name}`)
            continue
          }
          if (all.length === 0) {
            continue
          }

          // Judged from the file's own record order rather than from @HD, which
          // these fixtures do not carry. See scanRef.
          if (scanRef(path, ref.name, extra).sorted === false) {
            skipped.push(`${name}:${ref.name} (not coordinate sorted)`)
            continue
          }

          const spans = all.map(r => ({
            start: r.start,
            end: r.start + (r.lengthOnRef || 1),
          }))

          for (const [min, max] of boundaryWindows(spans, ref.length)) {
            const mine = await open().getRecordsForRange(ref.id, min, max)
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
        }
      },
      180_000,
    )

    // A run where every file quietly errored out, or where the region generator
    // stopped producing windows, would otherwise pass while checking nothing.
    test('covers enough of the corpus to be meaningful', () => {
      if (skipped.length) {
        console.warn(`not arbitrated by samtools: ${skipped.join(', ')}`)
      }
      expect(indexedCrams.length).toBeGreaterThanOrEqual(40)
      expect(identityComparisons).toBeGreaterThanOrEqual(100)
      expect(countComparisons).toBeGreaterThanOrEqual(20)
    })
  },
)
