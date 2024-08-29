//@ts-nocheck
import { describe, it, expect } from 'vitest'
import { sequenceMD5 } from '../src/cramFile/util'

describe('util.sequenceMD5', () => {
  ;[
    [
      `ACGTACGTACGT ACGtAC GTACGT...
    12345!!!`,
      'dfabdbb36e239a6da88957841f32b8e4',
    ],
    [
      'AGCATGTTAGAT  AA**GATAGCTGTGCTAGTAGGCAGTCAGCGCCAT',
      'caad65b937c4bc0b33c08f62a9fb5411',
    ],
  ].forEach(([input, output]) => {
    it(`can calculate MD5 of ${input} correctly`, () => {
      expect(sequenceMD5(input)).toEqual(output)
    })
  })
})
