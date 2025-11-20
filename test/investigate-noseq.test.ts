import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { dumpWholeFile } from './lib/dumpFile'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

test('investigate c1#noseq.tmp.cram', async () => {
  const fasta = new FetchableSmallFasta(testDataFile('c1.fa'))
  const seqFetch = fasta.fetch.bind(fasta)
  const file = new CramFile({
    filehandle: testDataFile('c1#noseq.tmp.cram'),
    seqFetch,
  })

  const fileData = await dumpWholeFile(file)

  let recordCount = 0
  const records: any[] = []

  for (const container of fileData) {
    if (container.data) {
      for (const item of container.data) {
        if (item.features && Array.isArray(item.features)) {
          for (const feature of item.features) {
            recordCount++
            const seq = feature.getReadBases ? feature.getReadBases() : 'N/A'
            const qualityScores = feature.qualityScores || []
            records.push({
              name: feature.readName,
              seq,
              seqLength: feature.readLength,
              flags: feature.flags,
              qualLen: qualityScores.length,
            })
            console.log(
              `${recordCount}. ${feature.readName} - seq: ${seq} (len=${feature.readLength}) - flags: ${feature.flags} - qual: ${qualityScores.length}`,
            )
          }
        }
      }
    }
  }

  console.log(`\nTotal records decoded: ${recordCount}`)
  console.log('Samtools reports: 9 records')
  console.log('Missing: ' + (9 - recordCount))
  console.log('\nRecord details:', JSON.stringify(records, null, 2))

  expect(recordCount).toEqual(9)
})
