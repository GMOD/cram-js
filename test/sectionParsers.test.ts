import { describe, expect, it } from 'vitest'

import { cramBlockHeader } from '../src/cramFile/sectionParsers.ts'
import { CramMalformedError, CramUnimplementedError } from '../src/errors.ts'

describe('block header errors', () => {
  const { parser } = cramBlockHeader()

  it('reports an unknown compression method as unimplemented', () => {
    expect(() => parser(new Uint8Array([99, 4, 0, 0, 0]))).toThrow(
      CramUnimplementedError,
    )
  })

  it('reports an unknown content type as malformed', () => {
    expect(() => parser(new Uint8Array([0, 99, 0, 0, 0]))).toThrow(
      CramMalformedError,
    )
  })
})
