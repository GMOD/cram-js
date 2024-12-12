import { LocalFile, RemoteFile } from 'generic-filehandle2'

import type { GenericFilehandle } from 'generic-filehandle2'

function open(
  maybeUrl?: string,
  maybePath?: string,
  maybeFilehandle?: GenericFilehandle,
): GenericFilehandle {
  if (maybeFilehandle) {
    return maybeFilehandle
  }
  if (maybeUrl) {
    return new RemoteFile(maybeUrl)
  }
  if (maybePath) {
    return new LocalFile(maybePath)
  }
  throw new Error('no url, path, or filehandle provided, cannot open')
}

export { open }

export { LocalFile, RemoteFile } from 'generic-filehandle2'
