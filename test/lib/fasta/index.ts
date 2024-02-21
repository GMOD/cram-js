function parseSmallFasta(text: string) {
  return text
    .split('>')
    .filter(t => /\S/.test(t))
    .map(entryText => {
      const [defLine, ...seq] = entryText.split('\n')
      const [id, ...des] = defLine.split(' ')
      const description = des.join(' ')
      const sequence = seq.join('').replace(/\s/g, '')
      return { id, description, sequence }
    })
}

class FetchableSmallFasta {
  data: Promise<ReturnType<typeof parseSmallFasta>>
  constructor(filehandle: { readFile: () => Promise<Buffer> }) {
    this.data = filehandle.readFile().then(buffer => {
      const text = buffer.toString('utf8')
      return parseSmallFasta(text)
    })
  }

  async fetch(id: number, start: number, end: number) {
    const data = await this.data
    const entry = data[id]
    const length = end - start + 1
    if (!entry) {
      throw new Error(`no sequence with id ${id} exists`)
    }
    return entry.sequence.slice(start - 1, start - 1 + length)
  }

  async getSequenceList() {
    const data = await this.data
    return data.map(entry => entry.id)
  }
}

export { parseSmallFasta, FetchableSmallFasta }
