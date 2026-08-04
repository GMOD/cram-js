const Constants = {
  CRAM_FLAG_PRESERVE_QUAL_SCORES: 1 << 0,
  CRAM_FLAG_DETACHED: 1 << 1,
  CRAM_FLAG_MATE_DOWNSTREAM: 1 << 2,
  CRAM_FLAG_NO_SEQ: 1 << 3,

  // MF, the mate flags of a detached record — see CRAMv3 §8.5 (Mate flags)
  //  the mate is mapped to the reverse strand
  CRAM_M_REVERSE: 1,
  //  the mate is unmapped
  CRAM_M_UNMAP: 2,

  //  the read is paired in sequencing, no matter whether it is mapped in a pair
  BAM_FPAIRED: 1,
  //  the read is mapped in a proper pair
  BAM_FPROPER_PAIR: 2,
  //  the read itself is unmapped; conflictive with BAM_FPROPER_PAIR
  BAM_FUNMAP: 4,
  //  the mate is unmapped
  BAM_FMUNMAP: 8,
  //  the read is mapped to the reverse strand
  BAM_FREVERSE: 16,
  //  the mate is mapped to the reverse strand
  BAM_FMREVERSE: 32,
  //  this is read1
  BAM_FREAD1: 64,
  //  this is read2
  BAM_FREAD2: 128,
  //  not primary alignment
  BAM_FSECONDARY: 256,
  //  QC failure
  BAM_FQCFAIL: 512,
  //  optical or PCR duplicate
  BAM_FDUP: 1024,
  //  supplementary alignment
  BAM_FSUPPLEMENTARY: 2048,
}

export default Constants
