const { IndexedCramFile, CramFile, CraiIndex } = window.gmodCRAM

// open local files
const indexedFile = new IndexedCramFile({
  cramUrl: 'volvox-sorted.cram',
  index: new CraiIndex({
    url: 'volvox-sorted.cram.crai',
  }),
  seqFetch: async (seqId, start, end) => {
    return ''
  },
  checkSequenceMD5: false,
})

// example of fetching records from an indexed CRAM file.
// NOTE: only numeric IDs for the reference sequence are accepted.
// For indexedfasta the numeric ID is the order in which the sequence names appear in the header

// Wrap in an async and then run
run = async () => {
  const records = await indexedFile.getRecordsForRange(0, 10000, 20000)
  records.forEach(record => {
    console.log(`got a record named ${record.readName}`)
    if (record.readFeatures != undefined) {
      record.readFeatures.forEach(({ code, pos, refPos, ref, sub }) => {
        if (code === 'X') {
          console.log(
            `${record.readName} shows a base substitution of ${ref}->${sub} at ${refPos}`,
          )
        }
      })
    }
  })
}

run()
