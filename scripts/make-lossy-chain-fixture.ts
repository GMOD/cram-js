// Regenerates test/data/ce#lossy3seg.cram: a three-segment template with its
// names dropped, chained 0 -> 1 -> 2 by a single NF walk. That chain is the
// only shape reaching the second link of `associateIntraSliceMate`, and writing
// such a template the obvious way detaches the middle record instead.
//
// htslib pairs each record against the last one seen under the same name and
// repoints its hash at it, so three records with one name chain — but each link
// must survive the checks in cram_encode.c's pairing block:
//
//   - PNEXT must be the previous record's POS;
//   - `p->mate_pos` is overwritten when a link is made, so link 1->2 compares
//     record 0's POS against record 2's — those two must share a position;
//   - TLEN must match the span htslib computes, or the link detaches on that
//     alone;
//   - READ1 and READ2 may each be set once across the group, so the middle
//     record carries neither;
//   - TC:i:3 makes `expected_template_count` agree with the three records seen,
//     which is what lets lossy_names discard all three names.
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
