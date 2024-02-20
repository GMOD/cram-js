import { fromUrl } from '../../src/io'
import path from 'path'

const dataDir = path && path.dirname(require.resolve('../data/xx.fa'))

export function testDataUrl(filename: string) {
  return `file://${dataDir}/${filename}`.replace('#', '%23')
}

export function testDataFile(filename: string) {
  const source = testDataUrl(filename)
  return fromUrl(source)
}
