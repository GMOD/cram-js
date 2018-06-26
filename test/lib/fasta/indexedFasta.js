class IndexedFasta {
  constructor({ fasta, fai, chunkSizeLimit = 50000 }) {
    this.fasta = fasta
    this.fai = fai

    this.indexes = this._readFAI()

    this.chunkSizeLimit = chunkSizeLimit
  }

  async _readFAI() {
    const indexByName = {}
    const indexById = {}
    const text = await this.fai.readFile()
    if (!(text && text.length))
      throw new Error('No data read from FASTA index (FAI) file')

    let idCounter = 0
    let currSeq
    text
      .toString('utf8')
      .split(/\r?\n/)
      .filter(line => /\S/.test(line))
      .forEach(line => {
        const row = line.split('\t')
        if (row[0] === '') return

        if (!currSeq || currSeq.name !== row[0]) {
          currSeq = { name: row[0], id: idCounter }
          idCounter += 1
        }

        const entry = {
          id: currSeq.id,
          name: row[0],
          length: +row[1],
          start: 0,
          end: +row[1],
          offset: +row[2],
          lineLength: +row[3],
          lineBytes: +row[4],
        }
        indexByName[entry.name] = entry
        indexById[entry.id] = entry
      })
    return { name: indexByName, id: indexById }
  }

  async fetch(seqId, min, max) {
    const indexEntry = (await this.indexes).id[seqId]
    return this._fetchFromIndexEntry(indexEntry, min, max)
  }

  async fetchByName(seqName, min, max) {
    const indexEntry = (await this.indexes).name[seqName]
    return this._fetchFromIndexEntry(indexEntry, min, max)
  }

  async _fetchFromIndexEntry(indexEntry, min, max) {
    const start = Math.max(0, min)
    const position = this._faiOffset(indexEntry, start)
    const readlen = this._faiOffset(indexEntry, max) - position

    let residues = Buffer.allocUnsafe(readlen)
    await this.data.read(residues, 0, readlen, position)
    residues = residues.toString('utf8').replace(/\s+/g, '')

    return {
      start,
      end: max,
      residues,
      seqName: indexEntry.name,
      seqId: indexEntry.id,
    }
  }

  _faiOffset(idx, pos) {
    return (
      idx.offset +
      idx.linebytelen * Math.floor(pos / idx.linelen) +
      (pos % idx.linelen)
    )
  }
}

// fetch: function(chr, min, max, featCallback, endCallback, errorCallback ) {
// errorCallback = errorCallback || function(e) { console.error(e); };

// },

// });

// });

module.exports = IndexedFasta
