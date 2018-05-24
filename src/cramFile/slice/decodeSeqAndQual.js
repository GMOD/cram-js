const BAM_CMATCH     = 0
const BAM_CINS       = 1
const BAM_CDEL       = 2
const BAM_CREF_SKIP  = 3
const BAM_CSOFT_CLIP = 4
const BAM_CHARD_CLIP = 5
const BAM_CPAD       = 6
const BAM_CEQUAL     = 7
const BAM_CDIFF      = 8
const BAM_CBACK      = 9

const BAM_CIGAR_STR  = "MIDNSHP=XB"
const BAM_CIGAR_SHIFT =4
const BAM_CIGAR_MASK = 0xf
const BAM_CIGAR_TYPE = 0x3C1A7


module.exports = function() {}


// module.exports = function decodeSeqAndQual(slice, cr, hasMD, hasNM, needDataSeries, decodeDataSeries) {
//   let /* int */ prev_pos = 0, f, r = 0, out_sz = 1;
//   let /* int */ seq_pos = 1;
//   let /* int */ cig_len = 0, ref_pos = cr.apos - 1;
//   let /* int32_t */  fn, i32;
//   let /* cigar_op */ cig_op = BAM_CMATCH;
//   //let /* uint32_t */  *cigar = s.cigar;
//   let /* uint32_t */  ncigar = s.ncigar;
//   let /* uint32_t */  cigar_alloc = s.cigar_alloc;
//   let /* uint32_t */  nm = 0;
//   let /* int32_t */  md_dist = 0;
//   let /* int */ orig_aux = 0;
//   let /* int */ decode_md = s.decode_md && s.ref && !hasMD && cr.ref_id >= 0;
//   let /* int */ decode_nm = s.decode_md && s.ref && !hasNM && cr.ref_id >= 0;
//   let /* uint32_t */  ds = s.data_series;
//   const cf = cr.cram_flags

//   if (needDataSeries('QS') && !(cf & CRAM_FLAG_PRESERVE_QUAL_SCORES)) {
//       cr.qual = new Array(cr.length).map(() => String.fromCharCode(255)).join('')
//   }

//   if (cr.cram_flags & CRAM_FLAG_NO_SEQ)
//       decode_md = decode_nm = 0;

//   if (decode_md) {
//     cr.aux.MDZ = null
//   }

//   if (needDataSeries('FN')) {
//     fn = decodeDataSeries('FN')
//   } else {
//     fn = 0;
//   }

//   //cr.cigar = ncigar;

//   if (!(needDataSeries('FC') || needDataSeries('FP')))
//       goto skip_cigar;

//   for (f = 0; f < fn; f++) {
//       int32_t pos = 0;
//       char op;

//       if (ncigar+2 >= cigar_alloc) {
//           cigar_alloc = cigar_alloc ? cigar_alloc*2 : 1024;
//           if (!(cigar = realloc(cigar, cigar_alloc * sizeof(*cigar))))
//               return -1;
//           s.cigar = cigar;
//       }

//       if (needDataSeries('FC')) {
//           if (!c.comp_hdr.codecs[DS_FC]) return -1;
//           r |= c.comp_hdr.codecs[DS_FC].decode(s,
//                                                   c.comp_hdr.codecs[DS_FC],
//                                                   blk,
//                                                   &op,  &out_sz);
//           if (r) return r;
//       }

//       if (!(needDataSeries('FP')))
//           continue;

//       if (!c.comp_hdr.codecs[DS_FP]) return -1;
//       r |= c.comp_hdr.codecs[DS_FP].decode(s,
//                                               c.comp_hdr.codecs[DS_FP],
//                                               blk,
//                                               (char *)&pos, &out_sz);
//       if (r) return r;
//       pos += prev_pos;

//       if (pos <= 0) {
//           hts_log_error("Feature position %d before start of read", pos);
//           return -1;
//       }

//       if (pos > seq_pos) {
//           if (pos > cr.length +1)
//               return -1;

//           if (s.ref && cr.ref_id >= 0) {
//               if (ref_pos + pos - seq_pos > bfd.ref[cr.ref_id].len) {
//                   static let /* int */ whinged = 0;
//                   let /* int */ rlen;
//                   if (!whinged)
//                       hts_log_warning("Ref pos outside of ref sequence boundary");
//                   whinged = 1;
//                   rlen = bfd.ref[cr.ref_id].len - ref_pos;
//                   // May miss MD/NM cases where both seq/ref are N, but this is a
//                   // malformed cram file anyway.
//                   if (rlen > 0) {
//                       if (ref_pos + rlen > s.ref_end)
//                           goto beyond_slice;

//                       memcpy(&seq[seq_pos-1],
//                              &s.ref[ref_pos - s.ref_start +1], rlen);
//                       if ((pos - seq_pos) - rlen > 0)
//                           memset(&seq[seq_pos-1+rlen], 'N',
//                                  (pos - seq_pos) - rlen);
//                   } else {
//                       memset(&seq[seq_pos-1], 'N', cr.length  - seq_pos + 1);
//                   }
//                   if (md_dist >= 0)
//                       md_dist += pos - seq_pos;
//               } else {
//                   // 'N' in both ref and seq is also mismatch for NM/MD
//                   if (ref_pos + pos-seq_pos > s.ref_end)
//                       goto beyond_slice;
//                   if (decode_md || decode_nm) {
//                       let /* int */ i;
//                       for (i = 0; i < pos - seq_pos; i++) {
//                           // FIXME: not N, but nt16 lookup == 15?
//                           char base = s.ref[ref_pos - s.ref_start + 1 + i];
//                           if (base == 'N') {
//                               add_md_char(s, decode_md,
//                                           s.ref[ref_pos - s.ref_start + 1 + i],
//                                           &md_dist);
//                               nm++;
//                           } else {
//                               md_dist++;
//                           }
//                           seq[seq_pos-1+i] = base;
//                       }
//                   } else {
//                       memcpy(&seq[seq_pos-1], &s.ref[ref_pos - s.ref_start +1],
//                              pos - seq_pos);
//                   }
//               }
//           }

//           if (cig_len && cig_op != BAM_CMATCH) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           cig_op = BAM_CMATCH;
//           cig_len += pos - seq_pos;
//           ref_pos += pos - seq_pos;
//           seq_pos = pos;
//       }

//       prev_pos = pos;

//       if (!(needDataSeries('FC')))
//           goto skip_cigar;

//       switch(op) {
//       case 'S': { // soft clip: IN
//           int32_t out_sz2 = 1;
//           let /* int */ have_sc = 0;

//           if (cig_len) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           switch (CRAM_MAJOR_VERS(fd.version)) {
//           case 1:
//               if (needDataSeries('IN')) {
//                   r |= c.comp_hdr.codecs[DS_IN]
//                       ? c.comp_hdr.codecs[DS_IN]
//                                    .decode(s, c.comp_hdr.codecs[DS_IN],
//                                             blk,
//                                             cr.length  ? &seq[pos-1] : NULL,
//                                             &out_sz2)
//                       : (seq[pos-1] = 'N', out_sz2 = 1, 0);
//                   have_sc = 1;
//               }
//               break;
//           case 2:
//           default:
//               if (needDataSeries('SC')) {
//                   r |= c.comp_hdr.codecs[DS_SC]
//                       ? c.comp_hdr.codecs[DS_SC]
//                                    .decode(s, c.comp_hdr.codecs[DS_SC],
//                                             blk,
//                                             cr.length  ? &seq[pos-1] : NULL,
//                                             &out_sz2)
//                       : (seq[pos-1] = 'N', out_sz2 = 1, 0);
//                   have_sc = 1;
//               }
//               break;

//               //default:
//               //    r |= c.comp_hdr.codecs[DS_BB]
//               //        ? c.comp_hdr.codecs[DS_BB]
//               //                     .decode(s, c.comp_hdr.codecs[DS_BB],
//               //                              blk, &seq[pos-1], &out_sz2)
//               //        : (seq[pos-1] = 'N', out_sz2 = 1, 0);
//           }
//           if (have_sc) {
//               if (r) return r;
//               cigar[ncigar++] = (out_sz2<<4) + BAM_CSOFT_CLIP;
//               cig_op = BAM_CSOFT_CLIP;
//               seq_pos += out_sz2;
//           }
//           break;
//       }

//       case 'X': { // Substitution; BS
//           unsigned char base;
//           let /* int */ ref_base;
//           if (cig_len && cig_op != BAM_CMATCH) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('BS')) {
//               if (!c.comp_hdr.codecs[DS_BS]) return -1;
//               r |= c.comp_hdr.codecs[DS_BS]
//                               .decode(s, c.comp_hdr.codecs[DS_BS], blk,
//                                        (char *)&base, &out_sz);
//               if (r) return -1;
//               if (cr.ref_id < 0 || ref_pos >= bfd.ref[cr.ref_id].len || !s.ref) {
//                   if (pos-1 < cr.length )
//                       seq[pos-1] = c.comp_hdr.
//                           substitution_matrix[fd.L1['N']][base];
//                   if (decode_md || decode_nm) {
//                       if (md_dist >= 0 && decode_md)
//                           BLOCK_APPEND_UINT(s.aux_blk, md_dist);
//                       md_dist = -1;
//                       nm--;
//                   }
//               } else {
//                   unsigned char ref_call = ref_pos < s.ref_end
//                       ? (uc)s.ref[ref_pos - s.ref_start +1]
//                       : 'N';
//                   ref_base = fd.L1[ref_call];
//                   if (pos-1 < cr.length )
//                       seq[pos-1] = c.comp_hdr.
//                           substitution_matrix[ref_base][base];
//                   add_md_char(s, decode_md, ref_call, &md_dist);
//               }
//           }
//           cig_op = BAM_CMATCH;
//           nm++;
//           cig_len++;
//           seq_pos++;
//           ref_pos++;
//           break;
//       }

//       case 'D': { // Deletion; DL
//           if (cig_len && cig_op != BAM_CDEL) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('DL')) {
//               if (!c.comp_hdr.codecs[DS_DL]) return -1;
//               r |= c.comp_hdr.codecs[DS_DL]
//                               .decode(s, c.comp_hdr.codecs[DS_DL], blk,
//                                        (char *)&i32, &out_sz);
//               if (r) return r;
//               if (decode_md || decode_nm) {
//                   if (ref_pos + i32 > s.ref_end)
//                       goto beyond_slice;
//                   if (md_dist >= 0 && decode_md)
//                       BLOCK_APPEND_UINT(s.aux_blk, md_dist);
//                   if (ref_pos + i32 <= bfd.ref[cr.ref_id].len) {
//                       if (decode_md) {
//                           BLOCK_APPEND_CHAR(s.aux_blk, '^');
//                           BLOCK_APPEND(s.aux_blk,
//                                        &s.ref[ref_pos - s.ref_start +1],
//                                        i32);
//                           md_dist = 0;
//                       }
//                       nm += i32;
//                   } else {
//                       let /* uint32_t */  dlen;
//                       if (bfd.ref[cr.ref_id].len >= ref_pos) {
//                           if (decode_md) {
//                               BLOCK_APPEND_CHAR(s.aux_blk, '^');
//                               BLOCK_APPEND(s.aux_blk,
//                                            &s.ref[ref_pos - s.ref_start+1],
//                                            bfd.ref[cr.ref_id].len-ref_pos);
//                               BLOCK_APPEND_UINT(s.aux_blk, 0);
//                           }
//                           dlen = i32 - (bfd.ref[cr.ref_id].len - ref_pos);
//                           nm += i32 - dlen;
//                       } else {
//                           dlen = i32;
//                       }

//                       md_dist = -1;
//                   }
//               }
//               cig_op = BAM_CDEL;
//               cig_len += i32;
//               ref_pos += i32;
//               //printf("  %d: DL = %d (ret %d)\n", f, i32, r);
//           }
//           break;
//       }

//       case 'I': { // Insertion (several bases); IN
//           int32_t out_sz2 = 1;

//           if (cig_len && cig_op != BAM_CINS) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }

//           if (needDataSeries('IN')) {
//               if (!c.comp_hdr.codecs[DS_IN]) return -1;
//               r |= c.comp_hdr.codecs[DS_IN]
//                               .decode(s, c.comp_hdr.codecs[DS_IN], blk,
//                                        cr.length  ? &seq[pos-1] : NULL,
//                                        &out_sz2);
//               if (r) return r;
//               cig_op = BAM_CINS;
//               cig_len += out_sz2;
//               seq_pos += out_sz2;
//               nm      += out_sz2;
//               //printf("  %d: IN(I) = %.*s (ret %d, out_sz %d)\n", f, out_sz2, dat, r, out_sz2);
//           }
//           break;
//       }

//       case 'i': { // Insertion (single base); BA
//           if (cig_len && cig_op != BAM_CINS) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('BA')) {
//               if (!c.comp_hdr.codecs[DS_BA]) return -1;
//               r |= c.comp_hdr.codecs[DS_BA]
//                               .decode(s, c.comp_hdr.codecs[DS_BA], blk,
//                                        cr.len ? &seq[pos-1] : NULL,
//                                        &out_sz);
//               if (r) return r;
//           }
//           cig_op = BAM_CINS;
//           cig_len++;
//           seq_pos++;
//           nm++;
//           break;
//       }

//       case 'b': { // Several bases
//           int32_t len = 1;

//           if (cig_len && cig_op != BAM_CMATCH) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }

//           if (needDataSeries('BB')) {
//               if (!c.comp_hdr.codecs[DS_BB]) return -1;
//               r |= c.comp_hdr.codecs[DS_BB]
//                   .decode(s, c.comp_hdr.codecs[DS_BB], blk,
//                            cr.len ? &seq[pos-1] : NULL,
//                            &len);
//               if (r) return r;

//               if (decode_md || decode_nm) {
//                   let /* int */ x;
//                   if (md_dist >= 0 && decode_md)
//                       BLOCK_APPEND_UINT(s.aux_blk, md_dist);

//                   for (x = 0; x < len; x++) {
//                       if (x && decode_md)
//                           BLOCK_APPEND_UINT(s.aux_blk, 0);
//                       if (ref_pos+x >= bfd.ref[cr.ref_id].len || !s.ref) {
//                           md_dist = -1;
//                           break;
//                       } else {
//                           if (decode_md) {
//                               if (ref_pos + x > s.ref_end)
//                                   goto beyond_slice;
//                               char r = s.ref[ref_pos+x-s.ref_start +1];
//                               BLOCK_APPEND_CHAR(s.aux_blk, r);
//                           }
//                       }
//                   }

//                   nm += x;
//               }
//           }

//           cig_op = BAM_CMATCH;

//           cig_len+=len;
//           seq_pos+=len;
//           ref_pos+=len;
//           //prev_pos+=len;
//           break;
//       }

//       case 'q': { // Several quality values
//           int32_t len = 1;

//           if (cig_len && cig_op != BAM_CMATCH) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }

//           if (needDataSeries('QQ')) {
//               if (!c.comp_hdr.codecs[DS_QQ]) return -1;
//               r |= c.comp_hdr.codecs[DS_QQ]
//                   .decode(s, c.comp_hdr.codecs[DS_QQ], blk,
//                            (char *)&qual[pos-1], &len);
//               if (r) return r;
//           }

//           cig_op = BAM_CMATCH;

//           cig_len+=len;
//           seq_pos+=len;
//           ref_pos+=len;
//           //prev_pos+=len;
//           break;
//       }

//       case 'B': { // Read base; BA, QS

//           if (cig_len && cig_op != BAM_CMATCH) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('BA')) {
//               if (!c.comp_hdr.codecs[DS_BA]) return -1;
//               r |= c.comp_hdr.codecs[DS_BA]
//                               .decode(s, c.comp_hdr.codecs[DS_BA], blk,
//                                        cr.len ? &seq[pos-1] : NULL,
//                                        &out_sz);

//               if (decode_md || decode_nm) {
//                   if (md_dist >= 0 && decode_md)
//                       BLOCK_APPEND_UINT(s.aux_blk, md_dist);
//                   if (ref_pos >= bfd.ref[cr.ref_id].len || !s.ref) {
//                       md_dist = -1;
//                   } else {
//                       if (decode_md) {
//                           if (ref_pos > s.ref_end)
//                               goto beyond_slice;
//                           BLOCK_APPEND_CHAR(s.aux_blk,
//                                             s.ref[ref_pos-s.ref_start +1]);
//                       }
//                       nm++;
//                       md_dist = 0;
//                   }
//               }
//           }
//           if (needDataSeries('QS')) {
//               if (!c.comp_hdr.codecs[DS_QS]) return -1;
//               r |= c.comp_hdr.codecs[DS_QS]
//                               .decode(s, c.comp_hdr.codecs[DS_QS], blk,
//                                        (char *)&qual[pos-1], &out_sz);
//           }

//           cig_op = BAM_CMATCH;
//           cig_len++;
//           seq_pos++;
//           ref_pos++;
//           //printf("  %d: BA/QS(B) = %c/%d (ret %d)\n", f, i32, qc, r);
//           break;
//       }

//       case 'Q': { // Quality score; QS
//           if (needDataSeries('QS')) {
//               if (!c.comp_hdr.codecs[DS_QS]) return -1;
//               r |= c.comp_hdr.codecs[DS_QS]
//                               .decode(s, c.comp_hdr.codecs[DS_QS], blk,
//                                        (char *)&qual[pos-1], &out_sz);
//               //printf("  %d: QS = %d (ret %d)\n", f, qc, r);
//           }
//           break;
//       }

//       case 'H': { // hard clip; HC
//           if (cig_len && cig_op != BAM_CHARD_CLIP) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('HC')) {
//               if (!c.comp_hdr.codecs[DS_HC]) return -1;
//               r |= c.comp_hdr.codecs[DS_HC]
//                               .decode(s, c.comp_hdr.codecs[DS_HC], blk,
//                                        (char *)&i32, &out_sz);
//               if (r) return r;
//               cig_op = BAM_CHARD_CLIP;
//               cig_len += i32;
//           }
//           break;
//       }

//       case 'P': { // padding; PD
//           if (cig_len && cig_op != BAM_CPAD) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('PD')) {
//               if (!c.comp_hdr.codecs[DS_PD]) return -1;
//               r |= c.comp_hdr.codecs[DS_PD]
//                               .decode(s, c.comp_hdr.codecs[DS_PD], blk,
//                                        (char *)&i32, &out_sz);
//               if (r) return r;
//               cig_op = BAM_CPAD;
//               cig_len += i32;
//           }
//           break;
//       }

//       case 'N': { // Ref skip; RS
//           if (cig_len && cig_op != BAM_CREF_SKIP) {
//               cigar[ncigar++] = (cig_len<<4) + cig_op;
//               cig_len = 0;
//           }
//           if (needDataSeries('RS')) {
//               if (!c.comp_hdr.codecs[DS_RS]) return -1;
//               r |= c.comp_hdr.codecs[DS_RS]
//                               .decode(s, c.comp_hdr.codecs[DS_RS], blk,
//                                        (char *)&i32, &out_sz);
//               if (r) return r;
//               cig_op = BAM_CREF_SKIP;
//               cig_len += i32;
//               ref_pos += i32;
//           }
//           break;
//       }

//       default:
//           hts_log_error("Unknown feature code '%c'", op);
//           return -1;
//       }
//   }

//   if (!(needDataSeries('FC')))
//       goto skip_cigar;

//   /* An implicit match op for any unaccounted for bases */
//   if ((needDataSeries('FN')) && cr.len >= seq_pos) {
//       if (s.ref && cr.ref_id >= 0) {
//           if (ref_pos + cr.len - seq_pos + 1 > bfd.ref[cr.ref_id].len) {
//               static let /* int */ whinged = 0;
//               let /* int */ rlen;
//               if (!whinged)
//                   hts_log_warning("Ref pos outside of ref sequence boundary");
//               whinged = 1;
//               rlen = bfd.ref[cr.ref_id].len - ref_pos;
//               // May miss MD/NM cases where both seq/ref are N, but this is a
//               // malformed cram file anyway.
//               if (rlen > 0) {
//                   if (seq_pos-1 + rlen < cr.len)
//                       memcpy(&seq[seq_pos-1],
//                              &s.ref[ref_pos - s.ref_start +1], rlen);
//                   if ((cr.len - seq_pos + 1) - rlen > 0)
//                       memset(&seq[seq_pos-1+rlen], 'N',
//                              (cr.len - seq_pos + 1) - rlen);
//               } else {
//                   if (cr.len - seq_pos + 1 > 0)
//                       memset(&seq[seq_pos-1], 'N', cr.len - seq_pos + 1);
//               }
//               if (md_dist >= 0)
//                   md_dist += cr.len - seq_pos + 1;
//           } else {
//               if (cr.len - seq_pos + 1 > 0) {
//                   if (ref_pos + cr.len-seq_pos +1 > s.ref_end)
//                       goto beyond_slice;
//                   if (decode_md || decode_nm) {
//                       let /* int */ i;
//                       for (i = 0; i < cr.len - seq_pos + 1; i++) {
//                           // FIXME: not N, but nt16 lookup == 15?
//                           char base = s.ref[ref_pos - s.ref_start + 1 + i];
//                           if (base == 'N') {
//                               add_md_char(s, decode_md,
//                                           s.ref[ref_pos - s.ref_start + 1 + i],
//                                           &md_dist);
//                               nm++;
//                           } else {
//                               md_dist++;
//                           }
//                           seq[seq_pos-1+i] = base;
//                       }
//                   } else {
//                       memcpy(&seq[seq_pos-1], &s.ref[ref_pos - s.ref_start +1],
//                              cr.len - seq_pos + 1);
//                   }
//               }
//               ref_pos += cr.len - seq_pos + 1;
//           }
//       } else if (cr.ref_id >= 0) {
//           // So alignment end can be computed even when not decoding sequence
//           ref_pos += cr.len - seq_pos + 1;
//       }

//       if (ncigar+1 >= cigar_alloc) {
//           cigar_alloc = cigar_alloc ? cigar_alloc*2 : 1024;
//           if (!(cigar = realloc(cigar, cigar_alloc * sizeof(*cigar))))
//               return -1;
//           s.cigar = cigar;
//       }

//       if (cig_len && cig_op != BAM_CMATCH) {
//           cigar[ncigar++] = (cig_len<<4) + cig_op;
//           cig_len = 0;
//       }
//       cig_op = BAM_CMATCH;
//       cig_len += cr.len - seq_pos+1;
//   }

// skip_cigar:

//   if ((needDataSeries('FN')) && decode_md) {
//       if (md_dist >= 0)
//           BLOCK_APPEND_UINT(s.aux_blk, md_dist);
//   }

//   if (cig_len) {
//       if (ncigar >= cigar_alloc) {
//           cigar_alloc = cigar_alloc ? cigar_alloc*2 : 1024;
//           if (!(cigar = realloc(cigar, cigar_alloc * sizeof(*cigar))))
//               return -1;
//           s.cigar = cigar;
//       }

//       cigar[ncigar++] = (cig_len<<4) + cig_op;
//   }

//   cr.ncigar = ncigar - cr.cigar;
//   cr.aend = ref_pos;

//   //printf("2: %.*s %d .. %d\n", cr.name_len, DSTRING_STR(name_ds) + cr.name, cr.apos, ref_pos);

//   if (needDataSeries('MQ')) {
//       if (!c.comp_hdr.codecs[DS_MQ]) return -1;
//       r |= c.comp_hdr.codecs[DS_MQ]
//                       .decode(s, c.comp_hdr.codecs[DS_MQ], blk,
//                                (char *)&cr.mqual, &out_sz);
//   } else {
//       cr.mqual = 40;
//   }

//   if ((needDataSeries('QS')) && (cf & CRAM_FLAG_PRESERVE_QUAL_SCORES)) {
//       int32_t out_sz2 = cr.len;

//       if (!c.comp_hdr.codecs[DS_QS]) return -1;
//       r |= c.comp_hdr.codecs[DS_QS]
//                       .decode(s, c.comp_hdr.codecs[DS_QS], blk,
//                                 qual, &out_sz2);
//   }

//   s.cigar = cigar;
//   s.cigar_alloc = cigar_alloc;
//   s.ncigar = ncigar;

//   if (cr.cram_flags & CRAM_FLAG_NO_SEQ)
//       cr.len = 0;

//   if (decode_md) {
//       BLOCK_APPEND_CHAR(s.aux_blk, '\0'); // null terminate MD:Z:
//       cr.aux_size += BLOCK_SIZE(s.aux_blk) - orig_aux;
//   }

//   if (decode_nm) {
//       char buf[7];
//       buf[0] = 'N'; buf[1] = 'M'; buf[2] = 'I';
//       buf[3] = (nm>> 0) & 0xff;
//       buf[4] = (nm>> 8) & 0xff;
//       buf[5] = (nm>>16) & 0xff;
//       buf[6] = (nm>>24) & 0xff;
//       BLOCK_APPEND(s.aux_blk, buf, 7);
//       cr.aux_size += 7;
//   }

//   return r;

// beyond_slice:
//   // Cramtools can create CRAMs that have sequence features outside the
//   // stated range of the container & slice reference extents (start + span).
//   // We have to check for these in many places, but for brevity have the
//   // error reporting in only one.
//   hts_log_error("CRAM CIGAR extends beyond slice reference extents");
//   return -1;
// }
