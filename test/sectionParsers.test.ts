import { describe, expect, it } from 'vitest'

import {
  cramBlockHeader,
  getSectionParsers,
} from '../src/cramFile/sectionParsers.ts'
import { CramMalformedError, CramUnimplementedError } from '../src/errors.ts'
import { CramFile } from '../src/index.ts'
import { testDataFile } from './lib/util.ts'

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

describe('compression header map sizes', () => {
  it('rejects a map whose declared size disagrees with its contents', async () => {
    const cram = new CramFile({
      filehandle: testDataFile('SRR396637.sorted.clip.cram'),
      useSliceWorkerPool: false,
    })
    const { majorVersion } = await cram.getDefinition()
    const container = await cram.getContainerById(1)
    const block = await container!.getCompressionHeaderBlock()
    const { parser } = getSectionParsers(majorVersion).cramCompressionHeader

    const content = block!.content
    expect(() => parser(content, 0)).not.toThrow()

    // the preservation map's size is the first ITF8, one byte when below 0x80
    expect(content[0]).toBeLessThan(0x7f)
    const corrupted = content.slice()
    corrupted[0] = content[0]! + 1
    expect(() => parser(corrupted, 0)).toThrow(CramMalformedError)
  })
})
