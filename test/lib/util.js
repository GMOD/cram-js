const path = typeof __webpack_require__ !== 'function' ? require('path') : null // eslint-disable-line camelcase
const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase
import { fromUrl } from '../../src/io'

const dataDir =
  path &&
  path.dirname(require.resolve('../data/xx#unsorted.tmp.cram.dump.json'))

function testDataUrl(filename) {
  return `file://${dataDir}/${filename}`.replace('#', '%23')
}

function testDataFile(filename) {
  const source = testDataUrl(filename)
  return fromUrl(source)
}

async function loadTestJSON(filename) {
  const data = await testDataFile(`${filename}`).readFile()
  const text = data.toString()
  return JSON.parse(text)
}

function JSONstringifyOrder(obj, space) {
  const allKeys = new Set()
  JSON.stringify(obj, (key, value) => (allKeys.add(key), value))
  return JSON.stringify(obj, Array.from(allKeys).sort(), space)
}

export function JsonClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

const REWRITE_EXPECTED_DATA =
  typeof process !== 'undefined' &&
  process.env.CRAMJS_REWRITE_EXPECTED_DATA &&
  process.env.CRAMJS_REWRITE_EXPECTED_DATA !== '0' &&
  process.env.CRAMJS_REWRITE_EXPECTED_DATA !== 'false'

module.exports = {
  testDataUrl,
  testDataFile,
  loadTestJSON,
  JsonClone,
  REWRITE_EXPECTED_DATA,
  fs,
}
