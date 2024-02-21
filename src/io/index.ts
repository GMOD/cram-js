import url from 'url'
import { ensureNotNullish } from '../typescript'
import { Filehandle } from '../cramFile/filehandle'
import { LocalFile, RemoteFile } from 'generic-filehandle'

function fromUrl(source: string) {
  const { protocol, pathname } = url.parse(source)
  if (protocol === 'file:') {
    return new LocalFile(unescape(ensureNotNullish(pathname)))
  }
  return new RemoteFile(source)
}

function open(
  maybeUrl?: string,
  maybePath?: string,
  maybeFilehandle?: Filehandle,
): Filehandle {
  if (maybeFilehandle) {
    return maybeFilehandle
  }
  if (maybeUrl) {
    return fromUrl(maybeUrl)
  }
  if (maybePath) {
    return new LocalFile(maybePath)
  }
  throw new Error('no url, path, or filehandle provided, cannot open')
}

export { fromUrl, open }

export { LocalFile, RemoteFile } from 'generic-filehandle'
