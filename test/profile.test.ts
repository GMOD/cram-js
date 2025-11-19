/* eslint-disable no-console */
import { test } from 'vitest'
import { Session } from 'node:inspector'
import { writeFileSync } from 'node:fs'
import { testDataFile } from '../test/lib/util'
import CraiIndex from '../src/craiIndex'
import { IndexedCramFile } from '../src/index'

test('generate CPU profile for SRR396637.sorted.clip.cram parsing', async () => {
  const session = new Session()
  session.connect()

  const profileData: unknown[] = []

  session.on('Profiler.Profile', message => {
    profileData.push(message)
  })

  session.post('Profiler.enable')
  session.post('Profiler.start')

  const iterations = 10
  let totalRecords = 0

  for (let i = 0; i < iterations; i++) {
    const cram = new IndexedCramFile({
      cramFilehandle: testDataFile('SRR396637.sorted.clip.cram'),
      index: new CraiIndex({
        filehandle: testDataFile('SRR396637.sorted.clip.cram.crai'),
      }),
    })

    const ret = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)
    totalRecords += ret.length
  }

  console.log(
    `Completed ${iterations} iterations, total records: ${totalRecords}`,
  )

  session.post('Profiler.stop', (err, { profile }) => {
    if (err) {
      console.error('Error stopping profiler:', err)
      return
    }

    writeFileSync(
      'SRR396637-parsing.cpuprofile',
      JSON.stringify(profile, null, 2),
    )
    console.log('CPU profile written to SRR396637-parsing.cpuprofile')
    session.disconnect()
  })

  await new Promise(resolve => setTimeout(resolve, 100))
})
