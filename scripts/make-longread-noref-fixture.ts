// Regenerates test/data/ce#longread.cram and ce#longread.noref.cram.
//
// The pair is the same synthetic long reads encoded twice: once against ce.fa,
// and once with `--output-fmt-option no_ref`, which makes htslib store every
// base verbatim as a 'b' read feature instead of computing substitutions. The
// mismatch test asserts the two agree, which is what proves cram-js recovers
// from a 'b' run exactly the substitutions the reference-based encoding spells
// out — through indels, and at a read length the 100bp htslib fixtures do not
// reach.
//
// Synthetic because no reference this repo ships covers a real long-read
// fixture: the ONT file's reads sit at chr1:55.6M-55.9M and `grc37-1.fa` is
// chr1:0-600k. The generator is seeded, so a rerun reproduces the fixture.
//
// Run with `node --experimental-strip-types scripts/make-longread-noref-fixture.ts`.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA = join(process.cwd(), 'test', 'data')
const CONTIG = 'CHROMOSOME_I'
const READS = 10
const MIN_LEN = 15_000
const MAX_LEN = 25_000
const SUB_RATE = 0.04
const INS_RATE = 0.005
const DEL_RATE = 0.005
const SEED = 20260815

function readContig(fasta: string, contig: string) {
  let seq = ''
  let inContig = false
  for (const line of readFileSync(fasta, 'utf8').split('\n')) {
    if (line.startsWith('>')) {
      // exact match: `>CHROMOSOME_IV` is also a prefix match for `>CHROMOSOME_I`
      inContig = line.trim() === `>${contig}`
    } else if (inContig) {
      seq += line.trim()
    }
  }
  return seq
}

// seeded so the committed fixture is reproducible
let state = SEED
function rand() {
  state = (state * 1103515245 + 12345) & 0x7fffffff
  return state / 0x7fffffff
}

const BASES = 'ACGT'
function otherBase(base: string) {
  let picked = BASES[Math.floor(rand() * 4)]!
  while (picked === base) {
    picked = BASES[Math.floor(rand() * 4)]!
  }
  return picked
}

const reference = readContig(join(DATA, 'ce.fa'), CONTIG)

interface Read {
  name: string
  start: number
  cigar: string
  bases: string
}

const reads: Read[] = []
for (let r = 0; r < READS; r++) {
  const span = MIN_LEN + Math.floor(rand() * (MAX_LEN - MIN_LEN))
  const start = Math.floor(rand() * (reference.length - span - 1))
  const ops: [number, string][] = []
  const push = (op: string) => {
    const last = ops.at(-1)
    if (last && last[1] === op) {
      last[0] += 1
    } else {
      ops.push([1, op])
    }
  }
  let bases = ''
  for (let i = 0; i < span; i++) {
    const refBase = reference[start + i]!.toUpperCase()
    const roll = rand()
    if (roll < DEL_RATE) {
      push('D')
    } else if (roll < DEL_RATE + INS_RATE) {
      bases += BASES[Math.floor(rand() * 4)]!
      push('I')
      bases += refBase
      push('M')
    } else if (roll < DEL_RATE + INS_RATE + SUB_RATE) {
      bases += otherBase(refBase)
      push('M')
    } else {
      bases += refBase
      push('M')
    }
  }
  reads.push({
    name: `synthetic_longread_${r}`,
    start: start + 1,
    cigar: ops.map(([n, op]) => `${n}${op}`).join(''),
    bases,
  })
}
reads.sort((a, b) => a.start - b.start)

const sam = join(DATA, 'ce#longread.sam')
writeFileSync(
  sam,
  [
    '@HD\tVN:1.6\tSO:coordinate',
    `@SQ\tSN:${CONTIG}\tLN:${reference.length}`,
    ...reads.map(read =>
      [
        read.name,
        0,
        CONTIG,
        read.start,
        60,
        read.cigar,
        '*',
        0,
        0,
        read.bases,
        '?'.repeat(read.bases.length),
      ].join('\t'),
    ),
    '',
  ].join('\n'),
)

for (const [name, extra] of [
  ['ce#longread.cram', []],
  ['ce#longread.noref.cram', ['--output-fmt-option', 'no_ref']],
] as const) {
  const out = join(DATA, name)
  execFileSync(
    'samtools',
    ['view', '-T', join(DATA, 'ce.fa'), '-C', ...extra, '-o', out, sam],
    { stdio: 'inherit' },
  )
  execFileSync('samtools', ['index', out], { stdio: 'inherit' })
  console.log(`wrote ${name}`)
}

// only the CRAMs are tracked; the SAM is 10x their size and derivable
rmSync(sam)
