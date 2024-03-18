import path from 'path'
import { LocalFile } from 'generic-filehandle'

const dataDir = path.dirname(require.resolve('../data/xx.fa'))

export function testDataFile(filename: string) {
  return new LocalFile(`${dataDir}/${filename}`)
}
