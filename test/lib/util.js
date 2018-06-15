const { promisify } = require('es6-promisify')
const zlib = require('zlib')

const gunzip = promisify(zlib.gunzip)

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
  let data = await testDataFile(`${filename}.gz`).readFile()
  data = await gunzip(data)
  const text = data.toString()
  return JSON.parse(text)
}

module.exports = {
  testDataUrl,
  testDataFile,
  loadTestJSON,
}
