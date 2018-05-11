const url = require('url')
const { LocalFile, RemoteFile } = require('../src/io')

function testDataUrl(filename) {
  return typeof window === 'undefined'
    ? `file://${require.resolve(`./data/${filename}`).replace('#', '%23')}`
    : `http://localhost:9876/base/test/data/${filename.replace('#', '%23')}`
}

function testDataFile(filename) {
  const source = testDataUrl(filename)
  const { protocol, pathname } = url.parse(source)
  if (protocol === 'file:') {
    return new LocalFile(unescape(pathname))
  }

  return new RemoteFile(source)
}

module.exports = {
  testDataUrl,
  testDataFile,
}
