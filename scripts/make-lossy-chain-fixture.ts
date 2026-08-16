// Regenerates test/data/ce#lossy3seg.cram.
//
// A three-segment template whose read names htslib drops, encoded so that all
// three records stay attached and form a single NF chain 0 -> 1 -> 2. That
// chain is the only shape that reaches the second link of the mate walk in
// `associateIntraSliceMate`, and no other fixture in test/data produces one:
// the obvious way to write a three-segment template detaches the middle record
// instead, leaving two independent links the walk handles either way.
//
// Getting all three attached takes reading `lossy_read_names` and the pairing
// block in htslib's cram_encode.c. htslib pairs each record against the last
// one seen under the same name and then repoints its hash at it, so three
// records with one name chain — but each link has to survive these checks:
//
//   - each record's PNEXT must be the previous record's POS;
//   - `p->mate_pos` is *overwritten* to `p`'s own mate's POS when a link is
//     made, so the check on link 1->2 compares record 0's POS against record
//     2's POS. Records 0 and 2 therefore have to share a position;
//   - TLEN must match the span htslib computes for the pair, or the link
//     detaches on the tlen check alone;
//   - READ1 and READ2 may each be set at most once across the group, so the
//     middle record carries neither;
//   - TC:i:3 makes `expected_template_count` agree with the three records
//     seen, which is what lets lossy_names discard all three names.
//
// Note samtools' own decode of this file does not give the group one name: it
// reads back as `<file>:1`, `<file>:2`, `<file>:1`, because htslib names a
// record after its mate line only where that line points backwards. cram-js
// gives all three the same name, which is what the pairing code needs.
//
// Run with `node --experimental-strip-types scripts/make-lossy-chain-fixture.ts`.
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA = join(process.cwd(), 'test', 'data')
const CONTIG = 'CHROMOSOME_I'
const NAME = 'ce#lossy3seg.cram'

// POS 100 / 150 / 100, and the PNEXT and TLEN each link needs. Flags are
// PAIRED plus READ1, nothing, and READ2.
const records = [
  [65, 100, 150, 60, 'GCCTAAGCCT'],
  [1, 150, 100, -60, 'AGCCTAAGCC'],
  [129, 100, 150, 60, 'CCTAAGCCTA'],
] as const

const sam = join(DATA, 'ce#lossy3seg.sam')
writeFileSync(
  sam,
  [
    // not coordinate sorted: the third record shares the first one's position
    '@HD\tVN:1.6\tSO:unknown',
    `@SQ\tSN:${CONTIG}\tLN:1009800`,
    ...records.map(([flags, pos, pnext, tlen, bases]) =>
      [
        'tri',
        flags,
        CONTIG,
        pos,
        60,
        '10M',
        '=',
        pnext,
        tlen,
        bases,
        'I'.repeat(bases.length),
        'TC:i:3',
      ].join('\t'),
    ),
    '',
  ].join('\n'),
)

const out = join(DATA, NAME)
execFileSync(
  'samtools',
  [
    'view',
    '-T',
    join(DATA, 'ce.fa'),
    '-C',
    '--output-fmt-option',
    'lossy_names=1',
    '--output-fmt-option',
    'seqs_per_slice=1000',
    '-o',
    out,
    sam,
  ],
  { stdio: 'inherit' },
)
console.log(`wrote ${NAME}`)

// only the CRAM is tracked; the SAM above is the whole of its source
rmSync(sam)
