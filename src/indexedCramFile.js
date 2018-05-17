const CramFile = require('./cramFile')

class IndexedCramFile {
  constructor({ cram, index /* fasta, fastaIndex */ }) {
    if (!(cram instanceof CramFile)) this.cram = new CramFile(cram)
    else this.cram = cram

    this.index = index
  }

  async getFeaturesForRange(seq, start, end) {
    if (typeof seq === 'string')
      // TODO: support string reference sequence names somehow
      throw new Error('string sequence names not yet supported')
    const seqId = seq
    const slices = await this.index.getEntriesForRange(seqId, start, end)

    // TODO: do we need to merge or de-duplicate the blocks?

    // fetch all the slices and parse the feature data
    const features = []
    const sliceResults = await Promise.all(
      slices.map(slice => this.getFeaturesInSlice(slice)),
    )
    for (let i = 0; i < sliceResults.length; i += 1) {
      const blockFeatures = sliceResults[i]
      blockFeatures.forEach(feature => {
        if (feature.start < end && feature.end > start) features.push(feature)
      })
    }
    return features
  }

  getFeaturesInSlice({ containerStart, sliceStart, sliceBytes }) {
    const container = this.cram.getContainerAtPosition(containerStart)
    const slice = container.getSlice(sliceStart, sliceBytes)
    return slice.getAllFeatures()
  }
}

module.exports = IndexedCramFile
