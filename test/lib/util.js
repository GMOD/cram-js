const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase
const { fromUrl } = require('../../src/io')

function testDataUrl(filename) {
  return typeof window === 'undefined'
    ? `file://${require.resolve(`../data/${filename}`).replace('#', '%23')}`
    : `http://localhost:9876/base/test/data/${filename.replace('#', '%23')}`
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

let extended = xit
try {
  if (fs.existsSync(require.resolve(`../data/extended/insilico_21.cram`)))
    extended = it
} catch (e) {
  // ignore
  console.log(
    'extended tests disabled, download the extended test dataset and fix all the symlinks in tests/data/extended to enable them',
  )
}

module.exports = {
  testDataUrl,
  testDataFile,
  loadTestJSON,
  extended,
}
