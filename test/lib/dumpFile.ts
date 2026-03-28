import type CramContainer from '../../src/cramFile/container/index.ts'
import type CramFile from '../../src/cramFile/file.ts'

async function dumpSlice(container: CramContainer, sliceOffset: number) {
  const slice = container.getSlice(sliceOffset, 0)
  const header = await slice.getHeader()
  const features = await slice.getAllRecords()
  return { header, features }
}

async function dumpContainerById(file: CramFile, containerId: number) {
  const container = await file.getContainerById(containerId)
  const containerHeader = await container.getHeader()
  const returnData: Record<string, unknown> = { containerHeader }
  let blockPosition: number
  let { numBlocks } = containerHeader
  // if this is not the first container, and the container has records in it,
  // there should be a compression header as the next block.
  if (containerId > 0 && containerHeader.numRecords) {
    const compressionHeader = await container.getCompressionHeaderBlock()
    const compressionScheme = await container.getCompressionScheme()
    blockPosition = compressionHeader!._endPosition
    returnData.compressionScheme = compressionScheme
    numBlocks -= 1
  } else {
    blockPosition = containerHeader._endPosition
  }
  const data: unknown[] = [containerHeader]
  for (let blockNum = 0; blockNum < numBlocks; blockNum += 1) {
    let block = await file.readBlock(blockPosition)
    if (
      block.contentType === 'MAPPED_SLICE_HEADER' ||
      block.contentType === 'UNMAPPED_SLICE_HEADER'
    ) {
      const slice = await dumpSlice(
        container,
        blockPosition - container.filePosition - containerHeader._size,
      )
      data.push(slice)
      // Skip the data blocks that belong to this slice
      // The slice header's numBlocks tells us how many data blocks follow
      const numSliceBlocks = slice.header.parsedContent.numBlocks
      for (let i = 0; i < numSliceBlocks; i++) {
        blockPosition = block._endPosition
        block = await file.readBlock(blockPosition)
      }
      blockNum += numSliceBlocks
    } else if (block.contentType === 'FILE_HEADER') {
      // use the getSamHeader
      data.push({ samHeader: await file.getSamHeader() })
    } else {
      data.push({ block })
    }
    blockPosition = block._endPosition
  }

  returnData.data = await Promise.all(data)
  return returnData
}

async function dumpWholeFile(file: CramFile) {
  // iterate through each container
  const items: unknown[] = [await file.getDefinition()]
  const containerCount = await file.containerCount()
  const dumpsP = [...new Array(containerCount).keys()].map((x, i) =>
    dumpContainerById(file, i),
  )
  const containerDumps = await Promise.all(dumpsP)
  items.push(...containerDumps)
  return items
}

export { dumpWholeFile }
