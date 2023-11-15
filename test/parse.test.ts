// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { CramFile } from '../src'

import { testDataFile } from './lib/util'

describe('CRAM reader', () => {
  it('can read a cram file definition', async () => {
    const file = new CramFile({
      filehandle: testDataFile('auxf#values.tmp.cram'),
    })
    const header = await file.getDefinition()
    expect(header).toEqual({
      magic: 'CRAM',
      majorVersion: 3,
      minorVersion: 0,
      fileId: '-',
    })
  })

  it('can read the first container header of a cram file', async () => {
    const file = new CramFile({
      filehandle: testDataFile('auxf#values.tmp.cram'),
    })
    const header = await (await file.getContainerById(0)).getHeader()
    expect(header).toEqual({
      alignmentSpan: 0,
      crc32: 2996618296,
      landmarks: [0, 161],
      length: 250,
      numBases: 0,
      numBlocks: 2,
      numLandmarks: 2,
      numRecords: 0,
      recordCounter: 0,
      _size: 19,
      _endPosition: 45,
      refSeqId: 0,
      refSeqStart: 0,
    })
  })

  it('can read the second container header of a cram file', async () => {
    const file = new CramFile({
      filehandle: testDataFile('auxf#values.tmp.cram'),
    })
    const container = await file.getContainerById(1)
    const header = await container.getHeader()
    expect(header).toEqual({
      alignmentSpan: 20,
      crc32: 3362745060,
      _size: 18,
      _endPosition: 313,
      landmarks: [1042],
      length: 3031,
      numBases: 20,
      numBlocks: 52,
      numLandmarks: 1,
      numRecords: 2,
      recordCounter: 0,
      refSeqId: 0,
      refSeqStart: 1,
    })
  })
  ;[
    'auxf#values.tmp.cram',
    'c1#bounds.tmp.cram',
    'c1#clip.tmp.cram',
    'c1#noseq.tmp.cram',
    'c1#pad1.tmp.cram',
    'c1#clip.2.1.cram',
    'c1#pad2.tmp.cram',
    'c1#pad3.tmp.cram',
    'c1#unknown.tmp.cram',
    'c2#pad.tmp.cram',
    'ce#1.tmp.cram',
    'ce#1000.tmp.cram',
    'ce#2.tmp.cram',
    'ce#5.tmp.cram',
    'ce#5b.tmp.cram',
    'ce#large_seq.tmp.cram',
    'ce#supp.tmp.cram',
    'ce#tag_depadded.tmp.cram',
    'ce#tag_padded.tmp.cram',
    'ce#unmap.tmp.cram',
    'ce#unmap1.tmp.cram',
    'ce#unmap2.tmp.cram',
    'headernul.tmp.cram',
    'md#1.tmp.cram',
    'sam_alignment.tmp.cram',
    'xx#blank.tmp.cram',
    'xx#large_aux.tmp.cram',
    'xx#large_aux2.tmp.cram',
    'xx#minimal.tmp.cram',
    'xx#pair.tmp.cram',
    'xx#repeated.tmp.cram',
    'xx#rg.tmp.cram',
    'xx#tlen.tmp.cram',
    'xx#tlen2.tmp.cram',
    'xx#triplet.tmp.cram',
    'xx#unsorted.tmp.cram',
  ].forEach(filename => {
    it(`can count containers in ${filename}`, async () => {
      const file = new CramFile({ filehandle: testDataFile(filename) })
      const count = await file.containerCount()
      expect(count).toMatchSnapshot()
    })
  })

  it('can read the compression header block and first slice header block from the 23rd container of ce#1000.tmp.cram', async () => {
    const file = new CramFile({ filehandle: testDataFile('ce#1000.tmp.cram') })
    const container = await file.getContainerById(23)
    const containerHeader = await container.getHeader()
    expect(containerHeader).toEqual({
      _endPosition: 108275,
      _size: 32,
      alignmentSpan: 0,
      crc32: 1355940116,
      landmarks: [383, 1351, 2299, 3242, 4208],
      length: 5156,
      numBases: 3500,
      numBlocks: 94,
      numLandmarks: 5,
      numRecords: 35,
      recordCounter: 770,
      refSeqId: -2,
      refSeqStart: 0,
    })
    const {
      content,
      parsedContent: compressionBlockData,
      ...compressionBlock
    } = await container.getCompressionHeaderBlock()
    expect(compressionBlock).toEqual({
      _size: 376,
      _endPosition: 108658,
      contentPosition: 108282,
      compressedSize: 372,
      contentId: 0,
      contentType: 'COMPRESSION_HEADER',
      compressionMethod: 'raw',
      uncompressedSize: 372,
      crc32: 1246026486,
    })
    expect(Object.keys(compressionBlockData).includes(['tagEncoding']))
    expect(Object.keys(compressionBlockData).includes(['preservation']))
    expect(Object.keys(compressionBlockData).includes(['dataSeriesEncoding']))
    expect(Object.keys(compressionBlockData).includes(['_size']))
    expect(Object.keys(compressionBlockData).includes(['_endPosition']))
    expect(compressionBlockData.preservation).toEqual({
      TD: [
        ['ASC', 'XSC', 'XNC', 'XMC', 'XOC', 'XGC', 'YTZ'],
        ['ASc', 'XSc', 'XNC', 'XMC', 'XOC', 'XGC', 'YTZ'],
      ],
      SM: [27, 27, 27, 27, 27],
      RN: true,
      AP: false,
    })
    expect(Object.keys(compressionBlockData.tagEncoding).length).toEqual(9)
    expect(Object.keys(compressionBlockData.dataSeriesEncoding).length).toEqual(
      21,
    )
  })
})
