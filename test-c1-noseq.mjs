import { CramFile } from './dist/index.js'
import { FetchableSmallFasta } from './test/lib/fasta.js'
import { testDataFile } from './test/lib/util.js'
import { dumpWholeFile } from './test/lib/dumpFile.js'

const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
const seqFetch = fasta.fetch.bind(fasta)
const file = new CramFile({
  filehandle: testDataFile('c1#noseq.tmp.cram'),
  seqFetch,
})

const fileData = await dumpWholeFile(file)

let recordCount = 0
console.log('Records found:')
for (const container of fileData) {
  if (container.data) {
    for (const item of container.data) {
      if (item.features && Array.isArray(item.features)) {
        for (const feature of item.features) {
          recordCount++
          const seq = feature.getReadBases ? feature.getReadBases() : 'N/A'
          console.log(
            `${recordCount}. ${feature.readName} - seq: ${seq} - flags: ${feature.flags}`,
          )
        }
      }
    }
  }
}

console.log(`\nTotal records: ${recordCount}`)
console.log('Samtools reports: 9 records')
console.log('Missing: ' + (9 - recordCount))
