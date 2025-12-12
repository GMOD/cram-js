import { LocalFile } from 'generic-filehandle2'
import { IndexedCramFile, CraiIndex } from '../esm/index.js'

const cramPath = 'test/data/SRR396637.sorted.clip.cram'

const cram = new IndexedCramFile({
  cramFilehandle: new LocalFile(cramPath),
  index: new CraiIndex({
    filehandle: new LocalFile(`${cramPath}.crai`),
  }),
})

await cram.cram.getSamHeader()
const records = await cram.getRecordsForRange(0, 0, 100_000_000)

let seqLen = 0
let tagCount = 0

for (const r of records) {
  seqLen += r.readLength
  tagCount += Object.keys(r.tags).length
  r.readName
  r.qualityScores
}

console.log(`Processed ${records.length} records`)
console.log(`Total seq length: ${seqLen}`)
console.log(`Total tags: ${tagCount}`)
