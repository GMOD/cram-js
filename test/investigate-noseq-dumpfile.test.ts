import { test } from 'vitest'

import { CramFile } from '../src'
import { dumpWholeFile } from './lib/dumpFile'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('noseq with dumpWholeFile', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const fileData = await dumpWholeFile(file)

  console.log(`FileData items: ${fileData.length}`)

  for (let i = 0; i < fileData.length; i++) {
    const container = fileData[i]
    console.log(`\nItem ${i}:`)

    if (container.data) {
      console.log(`  Has data with ${container.data.length} items`)

      for (let j = 0; j < container.data.length; j++) {
        const item = container.data[j]
        console.log(`  Item ${j}: ${JSON.stringify(Object.keys(item))}`)

        if (item.features) {
          console.log(`    Features: ${item.features.length} records`)
          item.features.forEach((f, idx) => {
            console.log(`      ${idx}: ${f.readName}`)
          })
        }
        if (item.header) {
          console.log(`    Slice header: ${item.header.parsedContent?.numRecords} records`)
        }
      }
    } else {
      console.log(`  No data property`)
    }
  }
}, 30000)
