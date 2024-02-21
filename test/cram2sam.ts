import { IndexedFasta } from '@gmod/indexedfasta'
import { CraiIndex, IndexedCramFile } from '../src'
import CramRecord from '../src/cramFile/record'

if (process.argv.length != 7) {
  process.stderr.write(
    'Usage: node jkb_test.js REF.fa input.cram tid start end\n',
  )
  process.exit(1)
}

const chr = process.argv[4]
const startStr = process.argv[5]
const endStr = process.argv[6]

const start = parseInt(startStr)
const end = parseInt(endStr)

// Fasta
const t = new IndexedFasta({
  path: process.argv[2],
  faiPath: process.argv[2] + '.fai',
})

// open local files
const indexedFile = new IndexedCramFile({
  cramPath: process.argv[3],
  index: new CraiIndex({
    path: process.argv[3] + '.crai',
  }),
  seqFetch: async (seqId, start, end) => {
    // note:
    // * seqFetch should return a promise for a string, in this instance retrieved from IndexedFasta
    // * we use start-1 because cram-js uses 1-based but IndexedFasta uses 0-based coordinates
    // * the seqId is a numeric identifier
    const seqList = await t.getSequenceNames()
    const r = await t.getSequence(seqList[seqId], start - 1, end)
    if (r === undefined) {
      throw new Error('getSequence returned undefined')
    }
    return r
  },
  checkSequenceMD5: false,
})

function decodeSeqCigar(record: CramRecord) {
  let sublen
  let seq = ''
  let cigar = ''
  let op = 'M'
  let oplen = 0

  // not sure I should access these, but...
  const ref = record._refRegion!.seq
  const refStart = record._refRegion!.start
  let last_pos = record.alignmentStart
  if (record.readFeatures !== undefined) {
    record.readFeatures.forEach(({ code, refPos, sub, data }) => {
      const sublen = refPos - last_pos
      seq += ref.slice(last_pos - refStart, refPos - refStart)
      last_pos = refPos

      if (oplen && op != 'M') {
        cigar += oplen + op
        oplen = 0
      }
      if (sublen) {
        op = 'M'
        oplen += sublen
      }

      if (code === 'b') {
        // An array of bases stored verbatim
        const ret = data.split(',')
        const added = String.fromCharCode(...ret)
        seq += added
        last_pos += added.length
        oplen += added.length
      } else if (code === 'B') {
        // Single base (+ qual score)
        seq += sub
        last_pos++
        oplen++
      } else if (code === 'X') {
        // Substitution
        seq += sub
        last_pos++
        oplen++
      } else if (code == 'D' || code == 'N') {
        // Deletion or Ref Skip
        last_pos += data
        if (oplen) {
          cigar += oplen + op
        }
        cigar += data + code
        oplen = 0
      } else if (code == 'I' || code == 'S') {
        // Insertion or soft-clip
        seq += data
        if (oplen) {
          cigar += oplen + op
        }
        cigar += data.length + code
        oplen = 0
      } else if (code == 'i') {
        // Single base insertion
        seq += data
        if (oplen) {
          cigar += oplen + op
        }
        cigar += 1 + 'I'
        oplen = 0
      } else if (code == 'P') {
        // Padding
        if (oplen) {
          cigar += oplen + op
        }
        cigar += data + 'P'
      } else if (code == 'H') {
        // Hard clip
        if (oplen) {
          cigar += oplen + op
        }
        cigar += data + 'H'
        oplen = 0
      } // else q or Q
    })
  } else {
    sublen = record.readLength - seq.length
  }
  if (seq.length != record.readLength) {
    sublen = record.readLength - seq.length
    seq += ref.slice(last_pos - refStart, last_pos - refStart + sublen)

    if (oplen && op != 'M') {
      cigar += oplen + op
      oplen = 0
    }
    op = 'M'
    oplen += sublen
  }
  if (oplen) {
    cigar += oplen + op
  }

  return [seq, cigar]
}

function tags2str(record: CramRecord, RG: string[]) {
  let str = ''
  for (const type in record.tags) {
    str += '\t'
    if (typeof record.tags[type] === 'number') {
      str += type + ':i:' + record.tags[type]
    } else if (typeof record.tags[type] === 'string') {
      str +=
        record.tags[type].length === 1
          ? type + ':A:' + record.tags[type]
          : type + ':Z:' + record.tags[type]
    } else {
      console.error(
        type,
        typeof record.tags[type],
        record.tags[type],
        record.readName,
      )
    }
  }

  if (typeof record.readGroupId !== undefined && record.readGroupId >= 0) {
    str += '\tRG:Z:' + RG[record.readGroupId]
  }
  return str
}

// Wrap in an async and then run
async function run() {
  // Turn chr into tid
  const seqList = await t.getSequenceNames()
  let tid: string | number = chr // ie numeric or string form
  seqList.forEach((name, id) => {
    if (name == chr) {
      tid = id
      return
    }
  })

  const hdr = await indexedFile.cram.getSamHeader()
  if (!hdr) {
    throw new Error('getSamHeader returned undefined')
  }
  const RG: string[] = []
  let nRG = 0
  for (const line of hdr) {
    if (line.tag === 'RG') {
      for (const entry of line.data) {
        if (entry.tag === 'ID') {
          RG[nRG++] = entry.value!
        }
      }
    }
  }

  // Region to query on.  NB gets mapped reads only
  if (typeof tid === 'string') {
    tid = parseInt(tid)
  }
  const records = await indexedFile.getRecordsForRange(tid >>> 0, start, end)

  //return; // benchmark decoder only

  let refStart: number | undefined = undefined
  records.forEach(record => {
    if (!refStart) {
      refStart = record.alignmentStart
    }
    const [seq, cigar] = decodeSeqCigar(record)

    //  // or record.getReadBases()
    //  if (seq != record.getReadBases()) {
    //      console.error("Incorrect seq decode");
    //      console.error(seq);
    //      console.error(record.getReadBases());
    //  }

    let qual = ''
    record.qualityScores!.forEach(q => {
      qual += String.fromCharCode(q + 33)
    })

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _rnext =
      record.sequenceId == record.mate!.sequenceId
        ? '='
        : seqList[record.sequenceId]
    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _tlen = record.templateSize // only if detached
    const tags = tags2str(record, RG)
    console.log(
      `${record.readName}\t${record.flags}\t${seqList[record.sequenceId]}\t${
        record.alignmentStart
      }\t${record.mappingQuality}\t${cigar}\t*\t0\t0\t${seq}\t${qual}${tags}`,
    )
  })
}

run().catch(e => console.error(e))
