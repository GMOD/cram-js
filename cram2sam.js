const { IndexedCramFile, CramFile, CraiIndex } = require('@gmod/cram')

//Use indexedfasta library for seqFetch, if using local file (see below)
const { IndexedFasta, BgzipIndexedFasta } = require('@gmod/indexedfasta') 


if (process.argv.length != 7) {
  process.stderr.write("Usage: node jkb_test.js REF.fa input.cram tid start end\n");
  process.exit(1);
}

const chr   = process.argv[4];
const start = process.argv[5];
const end   = process.argv[6];

// Fasta
const t = new IndexedFasta({
  path: process.argv[2],
  faiPath: process.argv[2] + ".fai"
});

// open local files
const indexedFile = new IndexedCramFile({
  //cramPath: '/var/tmp/9827_10m.cram',
  //cramPath: '/var/tmp/9827_10m.3.1.cram',
  //cramPath: '/var/tmp/novaseq-10m.cram',
  cramPath: process.argv[3],
  index: new CraiIndex({
    //path: '/var/tmp/9827_10m.cram.crai',
    //path: '/var/tmp/9827_10m.3.1.cram.crai',
    //path: '/var/tmp/novaseq-10m.cram.crai',
    path: process.argv[3] + ".crai",
  }),
  seqFetch: async (seqId, start, end) => {
    // note: 
    // * seqFetch should return a promise for a string, in this instance retrieved from IndexedFasta
    // * we use start-1 because cram-js uses 1-based but IndexedFasta uses 0-based coordinates
    // * the seqId is a numeric identifier
    const seqList = await t.getSequenceList()
    return ref = await t.getSequence(seqList[seqId], start-1, end)
  },
  checkSequenceMD5: false,
})

function decodeSeqCigar(record) {
  var seq = "";
  var cigar = "";
  var op = "M";
  var oplen = 0;

  // not sure I should access these, but...
  const ref = record._refRegion.seq
  const refStart = record._refRegion.start
  var last_pos = record.alignmentStart
  if (typeof record.readFeatures !== 'undefined') {
    record.readFeatures.forEach(({code, refPos, sub, data}) => {
      var sublen = refPos - last_pos
      seq += ref.substring(last_pos-refStart,refPos-refStart)
      last_pos = refPos;

      if (oplen && op != "M") {
        cigar += oplen + op;
        oplen = 0;
      }
      if (sublen) {
        op = "M";
        oplen += sublen;
      }

      if (code === 'b') {
        // An array of bases stored verbatim
        const ret = feature.data.split(',')
        const added = String.fromCharCode(...ret)
        seq += added
        last_pos += added.length;
        oplen += added.length;
      } else if (code === 'B') {
        // Single base (+ qual score)
        seq += sub;
        last_pos++;
        oplen++;
      } else if (code === 'X') {
        // Substitution
        seq += sub
        last_pos++
        oplen++
      } else if (code == 'D' || code == 'N') {
        // Deletion or Ref Skip
        last_pos+=data
        if (oplen) cigar += oplen + op
        cigar += data + code
        oplen = 0
      } else if (code == 'I' || code == 'S') {
        // Insertion or soft-clip
        seq += data
        if (oplen) cigar += oplen + op
        cigar += data.length + code
        oplen = 0
      } else if (code == 'i') {
        // Single base insertion
        seq += data;
        if (oplen) cigar += oplen + op
        cigar += 1 + "I"
        oplen = 0;
      } else if (code == 'P') {
        // Padding
        if (oplen) cigar += oplen + op
        cigar += data + "P"
      } else if (code == 'H') {
        // Hard clip
        if (oplen) cigar += oplen + op
        cigar += data + "H"
        oplen = 0
      } // else q or Q
    })
  } else {
    var sublen = record.readLength - seq.length
  }
  if (seq.length != record.readLength) {
    var sublen = record.readLength - seq.length
    seq += ref.substring(last_pos-refStart, last_pos-refStart + sublen)

    if (oplen && op != "M") {
      cigar += oplen + op;
      oplen = 0;
    }
    op = "M"
    oplen += sublen
  }
  if (oplen) cigar += oplen + op

  return [seq, cigar]
}

function tags2str(record, RG) {
  var str=""
  for (var type in record.tags) {
    str += "\t"
    if (typeof(record.tags[type]) === "number") {
      str += type + ":i:" + record.tags[type]
    } else if (typeof(record.tags[type]) === "string") {
      if (record.tags[type].length === 1)
        str += type + ":A:" + record.tags[type]
      else
        str += type + ":Z:" + record.tags[type]
    } else {
      console.error(type,typeof(record.tags[type]),record.tags[type], record.readName)
    }
  }

  if (typeof record.readGroupId !== undefined && record.readGroupId >= 0) {
    str += "\tRG:Z:" + RG[record.readGroupId]
  }
  return str
}

// Wrap in an async and then run
run = async() => {
  // Turn chr into tid
  const seqList = await t.getSequenceList()
  var tid=chr // ie numeric or string form
  seqList.forEach((name, id) => {
    if (name == chr) {
      tid=id
      return
    }
  })

  const hdr = await indexedFile.cram.getSamHeader();
  var RG = []
  var nRG = 0
  for (var line in hdr) {
    if (hdr[line].tag === "RG") {
      for (var i in hdr[line].data) {
        if (hdr[line].data[i].tag === "ID") {
          RG[nRG++] = hdr[line].data[i].value
        }
      }
    }
  }

  // Region to query on.  NB gets mapped reads only
  const records = await indexedFile.getRecordsForRange(tid>>>0, start, end)

  //return; // benchmark decoder only

  var refStart = undefined;
  records.forEach(record => {
    if (!refStart) refStart = record.alignmentStart
    var [seq, cigar] = decodeSeqCigar(record);

    //  // or record.getReadBases()
    //  if (seq != record.getReadBases()) {
    //      console.error("Incorrect seq decode");
    //      console.error(seq);
    //      console.error(record.getReadBases());
    //  }

    qual = ""
    record.qualityScores.forEach(q => {
      qual += String.fromCharCode(q+33);
    })

    var rnext = record.sequenceId == record.mate.sequenceId
        ? "=" : seqList[record.sequenceId]
    var tlen = record.templateSize; // only if detached
    const tags = tags2str(record, RG)
    console.log(`${record.readName}\t${record.flags}\t${seqList[record.sequenceId]}\t${record.alignmentStart}\t${record.mappingQuality}\t${cigar}\t*\t0\t0\t${seq}\t${qual}${tags}`)
  })
}

run()
