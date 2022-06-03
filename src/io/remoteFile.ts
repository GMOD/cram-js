import fetch from 'cross-fetch'
import BufferCache from './bufferCache'
import { Filehandle } from '../cramFile/filehandle'

export default class RemoteFile implements Filehandle {
  private _stat: { size: number } | undefined
  private position: 0
  private cache: BufferCache

  constructor(private url: string) {
    this.position = 0
    this.cache = new BufferCache({
      fetch: (start, length) => this._fetch(start, length),
    })
  }

  async _fetch(position: number, length: number) {
    const headers: Record<string, string> = {}
    if (length < Infinity) {
      headers.range = `bytes=${position}-${position + length}`
    } else if (length === Infinity && position !== 0) {
      headers.range = `bytes=${position}-`
    }
    const response = await fetch(this.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      mode: 'cors',
    })
    if (
      (response.status === 200 && position === 0) ||
      response.status === 206
    ) {
      const nodeBuffer = Buffer.from(await response.arrayBuffer())

      // try to parse out the size of the remote file
      const sizeMatch = /\/(\d+)$/.exec(response.headers.get('content-range')!)
      if (sizeMatch![1]) {
        this._stat = { size: parseInt(sizeMatch![1], 10) }
      }

      return nodeBuffer
    }
    throw new Error(`HTTP ${response.status} fetching ${this.url}`)
  }

  read(
    buffer: Buffer,
    offset = 0,
    length = Infinity,
    position: number | null = 0,
  ) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }
    return this.cache.get(buffer, offset, length, position ?? 0)
  }

  async readFile() {
    const response = await fetch(this.url, {
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
    })
    return Buffer.from(await response.arrayBuffer())
  }

  async stat() {
    if (!this._stat) {
      const buf = Buffer.allocUnsafe(10)
      await this.read(buf, 0, 10, 0)
      if (!this._stat) {
        throw new Error(`unable to determine size of file at ${this.url}`)
      }
    }
    return this._stat
  }
}
