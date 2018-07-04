const IndexedFasta = require('./indexedFasta')

function parseSmallFasta(text) {
  return text
    .split('>')
    .filter(t => /\S/.test(t))
    .map(entryText => {
      let [defLine, ...seqLines] = entryText.split('\n')
      let [id, ...description] = defLine.split(' ')
      description = description.join(' ')
      seqLines = seqLines.join('')
      const sequence = seqLines.replace(/\s/g, '')
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
    if (!entry) throw new Error(`no sequence with id ${id} exists`)
    return entry.sequence.substr(start - 1, length)
  }

  async getSequenceList() {
    const data = await this.data
    return data.map(entry => entry.id)
  }
}

module.exports = { parseSmallFasta, FetchableSmallFasta, IndexedFasta }
