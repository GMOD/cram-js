/**
 * CIGAR operations as the SAM/BAM spec numbers them, so that an op code from
 * {@link CramRecord.forEachCigarOp} means the same thing as one read out of a
 * BAM record's packed CIGAR array.
 *
 * See SAM/BAM spec §4.2 (the `CIGAR` field's op codes):
 * https://samtools.github.io/hts-specs/SAMv1.pdf
 *
 * CRAM read features only ever produce the first seven; `=` and `X` are here so
 * the numbering does not stop short of the spec's.
 * SYNC: ~/src/gmod/bam-js src/cigar.ts
 */
export const CIGAR_MATCH = 0
export const CIGAR_INS = 1
export const CIGAR_DEL = 2
export const CIGAR_REF_SKIP = 3
export const CIGAR_SOFT_CLIP = 4
export const CIGAR_HARD_CLIP = 5
export const CIGAR_PAD = 6
export const CIGAR_EQUAL = 7
export const CIGAR_DIFF = 8

/** the op characters, indexed by the codes above */
export const CIGAR_OP_CHARS = 'MIDNSHP=X'

/**
 * Called once per CIGAR operation, in order, with the op as one of the
 * `CIGAR_*` codes above and how many bases it covers.
 */
export type CigarCallback = (op: number, length: number) => void
