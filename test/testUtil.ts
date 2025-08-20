import { expect, test } from 'vitest'

import { CramFile } from '../src'
import { dumpWholeFile } from './lib/dumpFile'
import { FetchableSmallFasta } from './lib/fasta'
import { testDataFile } from './lib/util'

export function testFile(filename: string) {
  test(`can dump the whole ${filename} without error`, async () => {
    const fasta = filename.includes('__')
      ? new FetchableSmallFasta(testDataFile(filename.replace(/__.+$/, '.fa')))
      : undefined
    expect(
      await dumpWholeFile(
        new CramFile({
          filehandle: testDataFile(filename),
          seqFetch: fasta ? (...args) => fasta.fetch(...args) : undefined,
        }),
      ),
    ).toMatchSnapshot()
  }, 30000)
}
