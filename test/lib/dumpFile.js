async function dumpSlice(container, sliceOffset) {
  const slice = container.getSlice(sliceOffset)
  const header = await slice.getHeader()
  const features = await slice.getAllRecords()
  return { header, features }
}

async function dumpContainerById(file, containerId) {
  const container = await file.getContainerById(containerId)
  const containerHeader = await container.getHeader()
  const returnData = { containerHeader }
  let blockPosition
  let { numBlocks } = containerHeader
  // if this is not the first container, and the container has records in it,
  // there should be a compression header as the next block.
  if (containerId > 0 && containerHeader.numRecords) {
    const compressionHeader = await container.getCompressionHeaderBlock()
    const compressionScheme = await container.getCompressionScheme()
    blockPosition = compressionHeader._endPosition
    returnData.compressionScheme = compressionScheme
    numBlocks -= 1
  } else {
    blockPosition = containerHeader._endPosition
  }
  const data = [containerHeader]
  for (let blockNum = 0; blockNum < numBlocks; blockNum += 1) {
    const block = await file.readBlock(blockPosition)
    if (
      block.contentType === 'MAPPED_SLICE_HEADER' ||
      block.contentType === 'UNMAPPED_SLICE_HEADER'
    ) {
      const slice = await dumpSlice(
        container,
        blockPosition - container.filePosition - containerHeader._size,
      )
      data.push(slice)
      blockNum += slice.header.parsedContent.numBlocks
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

async function dumpWholeFile(file) {
  // iterate through each container
  const items = [await file.getDefinition()]
  const containerCount = await file.containerCount()
  const dumpsP = [...Array(containerCount).keys()].map((x, i) =>
    dumpContainerById(file, i),
  )
  const containerDumps = await Promise.all(dumpsP)
  items.push(...containerDumps)
  return items
}

module.exports = { dumpWholeFile }
