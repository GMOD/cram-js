//@ts-nocheck
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
  constructor(filehandle) {
    this.data = filehandle.readFile().then(buffer => {
      const text = buffer.toString('utf8')
      return parseSmallFasta(text)
    })
  }

  async fetch(id, start, end) {
    const data = await this.data
    const entry = data[id]
    const length = end - start + 1
    if (!entry) {
      throw new Error(`no sequence with id ${id} exists`)
    }
    return entry.sequence.substr(start - 1, length)
  }

  async getSequenceList() {
    const data = await this.data
    return data.map(entry => entry.id)
  }
}

export { parseSmallFasta, FetchableSmallFasta }
