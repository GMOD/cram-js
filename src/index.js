import url from 'url'

import { LocalFile, RemoteFile } from './io'
import structs from './structs'

export class CramFile {
  constructor(source) {
    const { protocol, pathname } = url.parse(source)
    if (protocol === 'file:') {
      this.file = new LocalFile(unescape(pathname))
    } else {
      this.file = new RemoteFile(source)
    }
  }

  async definition() {
    const headbytes = Buffer.allocUnsafe(26)
    await this.file.read(headbytes, 0, 26, 0)
    return structs.cramFileDefinition.parse(headbytes)
  }
}

export class IndexedCramFile {
  //  constructor({ cram, crai, fasta, fai }) {}
}
