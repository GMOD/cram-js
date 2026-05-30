import { describe, expect, it } from 'vitest'

import CramContainerCompressionScheme from '../src/cramFile/container/compressionScheme.ts'

import type { CramCompressionHeader } from '../src/cramFile/sectionParsers.ts'

// Minimal header; only the preservation map matters for these defaults.
function header(
  preservation: Partial<CramCompressionHeader['preservation']>,
): CramCompressionHeader {
  return {
    preservation: { SM: [0, 0, 0, 0, 0], TD: [], ...preservation },
    dataSeriesEncoding: {},
    tagEncoding: {},
    _size: 0,
    _endPosition: 0,
  }
}

// The CRAM spec defines defaults for absent preservation-map keys, matching
// htslib cram_decode.c: RN=false, AP=true, RR=true. Regression guard for a bug
// where absent AP/RR were treated as false (absolute positions / no reference).
describe('preservation-map defaults', () => {
  it('applies spec defaults when RN/AP/RR are absent', () => {
    const scheme = new CramContainerCompressionScheme(header({}))
    expect(scheme.readNamesIncluded).toBe(false)
    expect(scheme.APdelta).toBe(true)
    expect(scheme.referenceRequired).toBe(true)
  })

  it('honors explicit values when present', () => {
    const scheme = new CramContainerCompressionScheme(
      header({ RN: true, AP: false, RR: false }),
    )
    expect(scheme.readNamesIncluded).toBe(true)
    expect(scheme.APdelta).toBe(false)
    expect(scheme.referenceRequired).toBe(false)
  })
})
