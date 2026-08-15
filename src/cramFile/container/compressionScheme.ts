import { dataSeriesTypes } from '../codecs/dataSeriesTypes.ts'
import { instantiateCodec } from '../codecs/index.ts'

import type CramCodec from '../codecs/_base.ts'
import type {
  DataSeriesEncodingKey,
  DataSeriesEncodingMap,
  DataSeriesTypes,
} from '../codecs/dataSeriesTypes.ts'
import type { CramEncoding } from '../encoding.ts'
import type {
  CramCompressionHeader,
  CramTagDictionary,
} from '../sectionParsers.ts'

// the data series table lives with the key union it defines, in
// codecs/dataSeriesTypes.ts; re-exported here for the call sites that have
// always reached for it through the compression scheme
export { dataSeriesTypes }
export type { DataSeriesTypes }

// For each reference base index 0..4 (A,C,G,T,N), the three other bases plus N
// (or T for ref=N), in the order they're packed into the 2-bit substitution code
const SUBSTITUTIONS = [
  ['C', 'G', 'T', 'N'],
  ['A', 'G', 'T', 'N'],
  ['A', 'C', 'T', 'N'],
  ['A', 'C', 'G', 'N'],
  ['A', 'C', 'G', 'T'],
] as const

function parseSubstitutionMatrix(byteArray: number[]) {
  const matrix: string[][] = new Array(5)
  for (let i = 0; i < 5; i++) {
    const row = new Array<string>(4)
    const byte = byteArray[i]!
    const subs = SUBSTITUTIONS[i]!
    for (let j = 0; j < 4; j++) {
      row[(byte >> (6 - 2 * j)) & 3] = subs[j]!
    }
    matrix[i] = row
  }
  return matrix
}

/** the matrix flattened to ASCII codes, so a substitution decode reads a byte */
function substitutionCodes(matrix: string[][]) {
  const codes = new Uint8Array(5 * 4)
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 4; i++) {
      codes[row * 4 + i] = matrix[row]?.[i]?.charCodeAt(0) ?? 0
    }
  }
  return codes
}

type DataSeriesCache = {
  [K in DataSeriesEncodingKey]?: CramCodec<DataSeriesTypes[K]>
}

export default class CramContainerCompressionScheme {
  public readNamesIncluded: boolean
  public APdelta: boolean
  public referenceRequired: boolean
  // the TD preservation map entry: tag-list index -> three-character tag ids
  public tagIdsDictionary: CramTagDictionary
  public substitutionMatrix: string[][]
  /**
   * {@link substitutionMatrix} as ASCII codes, indexed `row * 4 + code`, so
   * that resolving a substitution reads a byte instead of a one-character
   * string. Derived, so the name ends in `Cache` — that is what keeps it out of
   * {@link toJSON} and therefore out of the snapshots.
   */
  public substitutionCodeCache: Uint8Array
  public dataSeriesCodecCache: DataSeriesCache = {}
  public tagCodecCache: Record<string, CramCodec> = {}
  public tagEncoding: Record<string, CramEncoding> = {}
  public dataSeriesEncoding: DataSeriesEncodingMap

  constructor(content: CramCompressionHeader) {
    // interpret some of the preservation map tags for convenient use
    // preservation-map defaults when a key is absent, per the CRAM spec
    // (matches htslib cram_decode.c): RN=false, AP=true, RR=true.
    this.readNamesIncluded = content.preservation.RN ?? false
    this.APdelta = content.preservation.AP ?? true
    this.referenceRequired = content.preservation.RR ?? true
    this.tagIdsDictionary = content.preservation.TD
    this.substitutionMatrix = parseSubstitutionMatrix(content.preservation.SM)
    this.substitutionCodeCache = substitutionCodes(this.substitutionMatrix)
    this.dataSeriesEncoding = content.dataSeriesEncoding
    this.tagEncoding = content.tagEncoding
  }

  /**
   * @param {string} tagName three-character tag name
   * @private
   */
  getCodecForTag(tagName: string): CramCodec {
    if (!this.tagCodecCache[tagName]) {
      const encodingData = this.tagEncoding[tagName]
      if (!encodingData) {
        throw new Error('Error, no tag encoding')
      }
      // all tags are byte array data
      this.tagCodecCache[tagName] = instantiateCodec(encodingData, 'byteArray')
    }
    return this.tagCodecCache[tagName]
  }

  getCodecForDataSeries<TDataSeries extends DataSeriesEncodingKey>(
    dataSeriesName: TDataSeries,
  ): CramCodec<DataSeriesTypes[TDataSeries]> | undefined {
    let r: CramCodec<DataSeriesTypes[TDataSeries]> | undefined =
      this.dataSeriesCodecCache[dataSeriesName]
    if (r === undefined) {
      const encodingData = this.dataSeriesEncoding[dataSeriesName]
      if (encodingData) {
        r = instantiateCodec(encodingData, dataSeriesTypes[dataSeriesName])
        // TS can't unify the per-key cache value type with the generic
        // TDataSeries — store via an untyped slot.
        this.dataSeriesCodecCache[dataSeriesName] =
          r as DataSeriesCache[TDataSeries]
      }
    }
    return r
  }

  // Used implicitly by snapshot tests to keep the codec caches (which contain
  // class instances and are noisy/non-stable) out of the serialized form.
  toJSON() {
    const data: Record<string, unknown> = {}
    Object.keys(this).forEach(k => {
      if (k.endsWith('Cache')) {
        return
      }
      data[k] = (this as Record<string, unknown>)[k]
    })
    return data
  }
}
