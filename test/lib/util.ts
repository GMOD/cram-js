import { LocalFile } from 'generic-filehandle2'

export function testDataFile(filename: string) {
  return new LocalFile(`test/data/${filename}`)
}
