export { CramRecord, NEXT_UNKNOWN } from './cramFile/record.ts'
export {
  CIGAR_DEL,
  CIGAR_DIFF,
  CIGAR_EQUAL,
  CIGAR_HARD_CLIP,
  CIGAR_INS,
  CIGAR_MATCH,
  CIGAR_OP_CHARS,
  CIGAR_PAD,
  CIGAR_REF_SKIP,
  CIGAR_SOFT_CLIP,
} from './cramFile/cigar.ts'
export type { CigarCallback } from './cramFile/cigar.ts'
export type {
  Mismatch,
  MismatchCallback,
  MismatchOptions,
} from './cramFile/mismatches.ts'
export type { ReadFeature, RefRegion } from './cramFile/record.ts'
export {
  RF_BASES,
  RF_BASE_QUAL,
  RF_DELETION,
  RF_HARD_CLIP,
  RF_INSERTION,
  RF_INSERT_BASE,
  RF_PADDING,
  RF_POSITIONAL,
  RF_QUAL,
  RF_QUALS,
  RF_REF_SKIP,
  RF_SOFT_CLIP,
  RF_SUBST,
  arenaFromReadFeatures,
  default as ReadFeatureArena,
} from './cramFile/readFeatureArena.ts'
export {
  TAG_ARRAY,
  TAG_CHAR,
  TAG_NUMBER,
  TAG_STRING,
  default as TagColumn,
} from './cramFile/tagColumn.ts'
export type { TagValue } from './cramFile/tagColumn.ts'
export { default as CramFile } from './cramFile/index.ts'
export {
  DEFAULT_CACHE_IDLE_TIMEOUT_MS,
  DEFAULT_CACHE_SIZE,
} from './cramFile/file.ts'
export type { ReferenceInfo, SeqFetch } from './cramFile/file.ts'
export { default as CraiIndex } from './craiIndex.ts'
export type { IndexOpts, Slice } from './craiIndex.ts'
export {
  createSliceWorkerPool,
  destroySharedSliceWorkerPool,
  getSharedSliceWorkerPool,
} from './sliceWorkerPool.ts'
export type { CramSliceWorkerPool } from './sliceWorkerPool.ts'
export { default as IndexedCramFile } from './indexedCramFile.ts'
export type { BaseOpts, ReadOpts } from './opts.ts'
