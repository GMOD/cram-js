// Regenerates test/data/tlenpairs#attached.cram, its index and reference: mate
// pairs that htslib stores attached (CF mate-downstream, no TS), so a reader has
// to compute TLEN itself, in the shapes where computing it from read length
// rather than reference span goes wrong — a deletion, a splice or a soft clip on
// the rightmost mate, and two mates with identical coordinates.
//
// htslib attaches a pair only when the TLEN in the input matches the one it
// would compute, so the TLEN column below is htslib's answer, and
// test/samtoolsAgreement.test.ts checks this reader against it.
//
// Run with `node --experimental-strip-types scripts/make-tlen-fixture.ts`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA = join(process.cwd(), 'test', 'data')
const CONTIG = 'tlenpairs'
const LENGTH = 20000

let state = 1
function nextBase() {
  state = (state * 1103515245 + 12345) % 2147483648
  return 'ACGT'[(state >> 16) & 3]!
}
let ref = ''
for (let i = 0; i < LENGTH; i++) {
  ref += nextBase()
}

/** read bases for `cigar` aligned at 1-based `pos`, soft clips as T */
function basesFor(pos: number, cigar: string) {
  let bases = ''
  let refPos = pos - 1
  for (const [, n, op] of cigar.matchAll(/(\d+)([MIDNS])/g)) {
    const len = Number(n)
    if (op === 'M') {
      bases += ref.slice(refPos, refPos + len)
      refPos += len
    } else if (op === 'D' || op === 'N') {
      refPos += len
    } else {
      bases += 'T'.repeat(len)
    }
  }
  return bases
}

// name, flag, pos, cigar, pnext, tlen — in file order, which is also the order
// htslib chains them in, so the first of each pair holds the NF link
const records = [
  ['leftclip', 99, 100, '10S90M', 300, 300],
  ['leftclip', 147, 300, '100M', 100, -300],
  ['deletion', 99, 1000, '100M', 1150, 270],
  ['deletion', 147, 1150, '50M20D50M', 1000, -270],
  ['insertion', 99, 2000, '45M10I45M', 2050, 150],
  ['insertion', 147, 2050, '100M', 2000, -150],
  ['rightclip', 99, 3000, '100M', 3200, 290],
  ['rightclip', 147, 3200, '90M10S', 3000, -290],
  ['contained', 99, 4000, '50M300N50M', 4100, 400],
  ['contained', 147, 4100, '100M', 4000, -400],
  ['spliced', 99, 5000, '100M', 5200, 5300],
  ['spliced', 147, 5200, '50M5000N50M', 5000, -5300],
  ['tieread2', 163, 12000, '100M', 12000, -100],
  ['tieread2', 83, 12000, '100M', 12000, 100],
  ['tieread1', 99, 13000, '100M', 13000, 100],
  ['tieread1', 147, 13000, '100M', 13000, -100],
] as const

const md5 = createHash('md5').update(ref).digest('hex')
writeFileSync(
  join(DATA, `${CONTIG}#attached.cram.sam_`),
  [
    '@HD\tVN:1.6\tSO:coordinate',
    `@SQ\tSN:${CONTIG}\tLN:${LENGTH}\tM5:${md5}`,
    ...records.map(([name, flag, pos, cigar, pnext, tlen]) => {
      const bases = basesFor(pos, cigar)
      return [
        name,
        flag,
        CONTIG,
        pos,
        60,
        cigar,
        '=',
        pnext,
        tlen,
        bases,
        'I'.repeat(bases.length),
      ].join('\t')
    }),
    '',
  ].join('\n'),
)

const fasta = join(DATA, `${CONTIG}.fa`)
writeFileSync(fasta, `>${CONTIG}\n${ref.replaceAll(/.{60}/g, '$&\n')}\n`)

// htslib finds the reference by M5 through REF_PATH rather than by `-T`, which
// would write this machine's absolute path to it into the header as UR
const refCache = mkdtempSync(join(tmpdir(), 'tlenpairs-'))
writeFileSync(join(refCache, md5), ref)
// relative paths from test/data, since htslib also writes the output path into
// the file definition as the file id
const cram = `${CONTIG}#attached.cram`
execFileSync(
  'samtools',
  [
    'view',
    '--no-PG',
    '-C',
    '--output-fmt-option',
    'version=3.0',
    '-o',
    cram,
    `${cram}.sam_`,
  ],
  {
    cwd: DATA,
    stdio: 'inherit',
    env: { ...process.env, REF_PATH: join(refCache, '%s'), REF_CACHE: '' },
  },
)
rmSync(refCache, { recursive: true })
execFileSync('samtools', ['index', cram], { cwd: DATA, stdio: 'inherit' })
console.log(`wrote ${join(DATA, cram)}`)
