module.exports = function() {}

// /* Resolve mate pair cross-references between recs within this slice */
// module.exports = function decodeSliceXrefs(slice, required_fields) {
// //static let /* int */ cram_decode_slice_xref(cram_slice *s, let /* int */ required_fields) {
//   let /* int */ rec;

//   if (!(required_fields & (SAM_RNEXT | SAM_PNEXT | SAM_TLEN))) {
//       for (rec = 0; rec < s.hdr.numRecords; rec++) {
//           cram_record *cr = &s.crecs[rec];

//           cr.tlen = 0;
//           cr.mate_pos = 0;
//           cr.mate_ref_id = -1;
//       }

//       return 0;
//   }

//   for (rec = 0; rec < s.hdr.numRecords; rec++) {
//       cram_record *cr = &s.crecs[rec];

//       if (cr.mate_line >= 0) {
//           if (cr.mate_line < s.hdr.numRecords) {
//               /*
//                * On the first read, loop through computing lengths.
//                * It's not perfect as we have one slice per reference so we
//                * cannot detect when TLEN should be zero due to seqs that
//                * map to multiple references.
//                *
//                * We also cannot set tlen correct when it spans a slice for
//                * other reasons. This may make tlen too small. Should we
//                * fix this by forcing TLEN to be stored verbatim in such cases?
//                *
//                * Or do we just admit defeat and output 0 for tlen? It's the
//                * safe option...
//                */
//               if (cr.tlen == INT_MIN) {
//                   let /* int */ id1 = rec, id2 = rec;
//                   let /* int */ aleft = cr.apos, aright = cr.aend;
//                   let /* int */ tlen;
//                   let /* int */ ref = cr.ref_id;

//                   // number of segments starting at the same point.
//                   let /* int */ left_cnt = 0;

//                   do {
//                       if (aleft > s.crecs[id2].apos)
//                           aleft = s.crecs[id2].apos, left_cnt = 1;
//                       else if (aleft == s.crecs[id2].apos)
//                           left_cnt++;
//                       if (aright < s.crecs[id2].aend)
//                           aright = s.crecs[id2].aend;
//                       if (s.crecs[id2].mate_line == -1) {
//                           s.crecs[id2].mate_line = rec;
//                           break;
//                       }
//                       if (s.crecs[id2].mate_line <= id2 ||
//                           s.crecs[id2].mate_line >= s.hdr.numRecords)
//                           return -1;
//                       id2 = s.crecs[id2].mate_line;

//                       if (s.crecs[id2].ref_id != ref)
//                           ref = -1;
//                   } while (id2 != id1);

//                   if (ref != -1) {
//                       tlen = aright - aleft + 1;
//                       id1 = id2 = rec;

//                       /*
//                        * When we have two seqs with identical start and
//                        * end coordinates, set +/- tlen based on 1st/last
//                        * bit flags instead, as a tie breaker.
//                        */
//                       if (s.crecs[id2].apos == aleft) {
//                           if (left_cnt == 1 ||
//                               (s.crecs[id2].flags & BAM_FREAD1))
//                               s.crecs[id2].tlen = tlen;
//                           else
//                               s.crecs[id2].tlen = -tlen;
//                       } else {
//                           s.crecs[id2].tlen = -tlen;
//                       }

//                       id2 = s.crecs[id2].mate_line;
//                       while (id2 != id1) {
//                           if (s.crecs[id2].apos == aleft) {
//                               if (left_cnt == 1 ||
//                                   (s.crecs[id2].flags & BAM_FREAD1))
//                                   s.crecs[id2].tlen = tlen;
//                               else
//                                   s.crecs[id2].tlen = -tlen;
//                           } else {
//                               s.crecs[id2].tlen = -tlen;
//                           }
//                           id2 = s.crecs[id2].mate_line;
//                       }
//                   } else {
//                       id1 = id2 = rec;

//                       s.crecs[id2].tlen = 0;
//                       id2 = s.crecs[id2].mate_line;
//                       while (id2 != id1) {
//                           s.crecs[id2].tlen = 0;
//                           id2 = s.crecs[id2].mate_line;
//                       }
//                   }
//               }

//               cr.mate_pos = s.crecs[cr.mate_line].apos;
//               cr.mate_ref_id = s.crecs[cr.mate_line].ref_id;

//               // paired
//               cr.flags |= BAM_FPAIRED;

//               // set mate unmapped if needed
//               if (s.crecs[cr.mate_line].flags & BAM_FUNMAP) {
//                   cr.flags |= BAM_FMUNMAP;
//                   cr.tlen = 0;
//               }
//               if (cr.flags & BAM_FUNMAP) {
//                   cr.tlen = 0;
//               }

//               // set mate reversed if needed
//               if (s.crecs[cr.mate_line].flags & BAM_FREVERSE)
//                   cr.flags |= BAM_FMREVERSE;
//           } else {
//               hts_log_error("Mate line out of bounds: %d vs [0, %d]",
//                             cr.mate_line, s.hdr.numRecords-1);
//           }

//           /* FIXME: construct read names here too if needed */
//       } else {
//           if (cr.mate_flags & CRAM_M_REVERSE) {
//               cr.flags |= BAM_FPAIRED | BAM_FMREVERSE;
//           }
//           if (cr.mate_flags & CRAM_M_UNMAP) {
//               cr.flags |= BAM_FMUNMAP;
//               //cr.mate_ref_id = -1;
//           }
//           if (!(cr.flags & BAM_FPAIRED))
//               cr.mate_ref_id = -1;
//       }

//       if (cr.tlen == INT_MIN)
//           cr.tlen = 0; // Just incase
//   }
//   return 0;
// }

// }
