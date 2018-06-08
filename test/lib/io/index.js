const url = require('url')
const RemoteFile = require('./remoteFile')
const LocalFile = require('./localFile')

module.exports = {
  LocalFile,
  RemoteFile,

  fromUrl(source) {
    const { protocol, pathname } = url.parse(source)
    if (protocol === 'file:') {
      return new LocalFile(unescape(pathname))
    }
    return new RemoteFile(source)
  },
}
