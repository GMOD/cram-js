const { fromUrl } = require('./io')

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

module.exports = {
  testDataUrl,
  testDataFile,
  loadTestJSON,
}
