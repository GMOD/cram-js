class CramSlice {
  constructor(container, offset, length) {
    this.container = container
    this.file = container.file
    this.containerOffset = offset
    this.size = length
  }

  async getHeader() {
    if (!this._header) {
      const containerHeader = await this.container.getHeader()
      this._header = await this.file.readBlock(
        containerHeader._endOffset + this.containerOffset,
        this.size,
      )
    }
    return this._header
  }

  // async getBlock(id) {
  //   if (this.blocks && id >= 0 && id < 256) {
  //     return this.blocks[id];
  //   } else {
  //       int v = 256 + (id > 0 ? id % 251 : (-id) % 251);
  //       if (this.blocks &&
  //           this.blocks[v] &&
  //           this.blocks[v]->content_id == id)
  //           return this.blocks[v];

  //       // Otherwise a linear search in case of collision
  //       int i;
  //       for (i = 0; i < this.hdr->num_blocks; i++) {
  //           cram_block *b = this.block[i];
  //           if (b && b->content_type == EXTERNAL && b->content_id == id)
  //               return b;
  //       }
  //   }
  // }

  async getAllFeatures() {
    // read the container and compression headers
    const containerHeader = await this.container.getHeader()
    const compressionBlock = await this.container.getCompressionBlock()

    console.log(JSON.stringify(compressionBlock, null, '  '))

    // read the slice header
    const sliceHeader = await this.file.readBlock(
      containerHeader._endOffset + this.containerOffset,
      this.size,
    )

    console.log(JSON.stringify(sliceHeader, null, '  '))

    const refId = sliceHeader.refSeqId
    const embeddedRefBaseID = sliceHeader.refBaseID

    //     if (refId >= 0) {
    //       if (embeddedRefBaseID >= 0) {
    //           const refBlock = cram_get_block_by_id(s, embeddedRefBaseID);
    //           if (!refBlock) throw new Error('embedded reference specified, but reference block does not exist')
    //           if (cram_uncompress_block(b) != 0)
    //               return -1;
    //           s->ref = (char *)BLOCK_DATA(b);
    //           s->ref_start = sliceHeader.ref_seq_start;
    //           s->ref_end   = sliceHeader.ref_seq_start + sliceHeader.ref_seq_span-1;
    //           if (s->ref_end - s->ref_start > b->uncomp_size) {
    //               hts_log_error("Embedded reference is too small");
    //               return -1;
    //           }
    //       } else if (!c->comp_hdr->no_ref) {
    //           //// Avoid Java cramtools bug by loading entire reference seq
    //           //s->ref = cram_get_ref(fd, sliceHeader.ref_seq_id, 1, 0);
    //           //s->ref_start = 1;

    //           if (fd->required_fields & SAM_SEQ)
    //               s->ref =
    //               cram_get_ref(fd, sliceHeader.ref_seq_id,
    //                            sliceHeader.ref_seq_start,
    //                            sliceHeader.ref_seq_start + sliceHeader.ref_seq_span -1);
    //           s->ref_start = sliceHeader.ref_seq_start;
    //           s->ref_end   = sliceHeader.ref_seq_start + sliceHeader.ref_seq_span-1;

    //           /* Sanity check */
    //           if (s->ref_start < 0) {
    //               hts_log_warning("Slice starts before base 1");
    //               s->ref_start = 0;
    //           }
    //           pthread_mutex_lock(&fd->ref_lock);
    //           pthread_mutex_lock(&fd->refs->lock);
    //           if ((fd->required_fields & SAM_SEQ) &&
    //               ref_id < fd->refs->nref &&
    //               s->ref_end > fd->refs->ref_id[ref_id]->length) {
    //               s->ref_end = fd->refs->ref_id[ref_id]->length;
    //           }
    //           pthread_mutex_unlock(&fd->refs->lock);
    //           pthread_mutex_unlock(&fd->ref_lock);
    //       }
    //   }

    //   if ((fd->required_fields & SAM_SEQ) &&
    //   s->ref == NULL && s->hdr->ref_seq_id >= 0 && !c->comp_hdr->no_ref) {
    //   hts_log_error("Unable to fetch reference #%d %d..%d",
    //                 s->hdr->ref_seq_id, s->hdr->ref_seq_start,
    //                 s->hdr->ref_seq_start + s->hdr->ref_seq_span-1);
    //   return -1;
    // }

    // if (CRAM_MAJOR_VERS(fd->version) != 1
    //   && (fd->required_fields & SAM_SEQ)
    //   && s->hdr->ref_seq_id >= 0
    //   && !fd->ignore_md5
    //   && memcmp(s->hdr->md5, "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", 16)) {
    //   hts_md5_context *md5;
    //   unsigned char digest[16];

    //   if (s->ref && s->hdr->ref_seq_id >= 0) {
    //       int start, len;

    //       if (s->hdr->ref_seq_start >= s->ref_start) {
    //           start = s->hdr->ref_seq_start - s->ref_start;
    //       } else {
    //           hts_log_warning("Slice starts before base 1");
    //           start = 0;
    //       }

    //       if (s->hdr->ref_seq_span <= s->ref_end - s->ref_start + 1) {
    //           len = s->hdr->ref_seq_span;
    //       } else {
    //           hts_log_warning("Slice ends beyond reference end");
    //           len = s->ref_end - s->ref_start + 1;
    //       }

    //       if (!(md5 = hts_md5_init()))
    //           return -1;
    //       if (start + len > s->ref_end - s->ref_start + 1)
    //           len = s->ref_end - s->ref_start + 1 - start;
    //       if (len >= 0)
    //           hts_md5_update(md5, s->ref + start, len);
    //       hts_md5_final(digest, md5);
    //       hts_md5_destroy(md5);
    //   } else if (!s->ref && s->hdr->ref_base_id >= 0) {
    //       cram_block *b = cram_get_block_by_id(s, s->hdr->ref_base_id);
    //       if (b) {
    //           if (!(md5 = hts_md5_init()))
    //               return -1;
    //           hts_md5_update(md5, b->data, b->uncomp_size);
    //           hts_md5_final(digest, md5);
    //           hts_md5_destroy(md5);
    //       }
    //   }

    //   if ((!s->ref && s->hdr->ref_base_id < 0)
    //       || memcmp(digest, s->hdr->md5, 16) != 0) {
    //       char M[33];
    //       hts_log_error("MD5 checksum reference mismatch for ref %d pos %d..%d",
    //                     ref_id, s->ref_start, s->ref_end);
    //       hts_log_error("CRAM: %s", md5_print(s->hdr->md5, M));
    //       hts_log_error("Ref : %s", md5_print(digest, M));
    //       return -1;
    //   }
    // }

    // if (ref_id == -2) {
    //   pthread_mutex_lock(&fd->ref_lock);
    //   pthread_mutex_lock(&fd->refs->lock);
    //   refs = calloc(fd->refs->nref, sizeof(char *));
    //   pthread_mutex_unlock(&fd->refs->lock);
    //   pthread_mutex_unlock(&fd->ref_lock);
    //   if (!refs)
    //       return -1;
    // }

    // int last_ref_id = -9; // Arbitrary -ve marker for not-yet-set
    // for (rec = 0; rec < s->hdr->num_records; rec++) {
    //   cram_record *cr = &s->crecs[rec];
    //   int has_MD, has_NM;

    //   //fprintf(stderr, "Decode seq %d, %d/%d\n", rec, blk->byte, blk->bit);

    //   cr->s = s;

    //   out_sz = 1; /* decode 1 item */
    //   if (ds & CRAM_BF) {
    //       if (!c->comp_hdr->codecs[DS_BF]) return -1;
    //       r |= c->comp_hdr->codecs[DS_BF]
    //                       ->decode(s, c->comp_hdr->codecs[DS_BF], blk,
    //                                (char *)&bf, &out_sz);
    //       if (r || bf < 0 ||
    //           bf >= sizeof(fd->bam_flag_swap)/sizeof(*fd->bam_flag_swap))
    //           return -1;
    //       bf = fd->bam_flag_swap[bf];
    //       cr->flags = bf;
    //   } else {
    //       cr->flags = bf = 0x4; // unmapped
    //   }

    //   if (ds & CRAM_CF) {
    //       if (CRAM_MAJOR_VERS(fd->version) == 1) {
    //           /* CF is byte in 1.0, int32 in 2.0 */
    //           if (!c->comp_hdr->codecs[DS_CF]) return -1;
    //           r |= c->comp_hdr->codecs[DS_CF]
    //                           ->decode(s, c->comp_hdr->codecs[DS_CF], blk,
    //                                    (char *)&cf, &out_sz);
    //           if (r) return -1;
    //           cr->cram_flags = cf;
    //       } else {
    //           if (!c->comp_hdr->codecs[DS_CF]) return -1;
    //           r |= c->comp_hdr->codecs[DS_CF]
    //                           ->decode(s, c->comp_hdr->codecs[DS_CF], blk,
    //                                    (char *)&cr->cram_flags, &out_sz);
    //           if (r) return -1;
    //           cf = cr->cram_flags;
    //       }
    //   } else {
    //       cf = cr->cram_flags = 0;
    //   }

    //   if (CRAM_MAJOR_VERS(fd->version) != 1 && ref_id == -2) {
    //       if (ds & CRAM_RI) {
    //           if (!c->comp_hdr->codecs[DS_RI]) return -1;
    //           r |= c->comp_hdr->codecs[DS_RI]
    //                           ->decode(s, c->comp_hdr->codecs[DS_RI], blk,
    //                                    (char *)&cr->ref_id, &out_sz);
    //           if (r) return -1;
    //           if ((fd->required_fields & (SAM_SEQ|SAM_TLEN))
    //               && cr->ref_id >= 0
    //               && cr->ref_id != last_ref_id) {
    //               if (!c->comp_hdr->no_ref) {
    //                   // Range(fd):  seq >= 0, unmapped -1, unspecified   -2
    //                   // Slice(s):   seq >= 0, unmapped -1, multiple refs -2
    //                   // Record(cr): seq >= 0, unmapped -1
    //                   pthread_mutex_lock(&fd->range_lock);
    //                   int need_ref = (fd->range.refid == -2 || cr->ref_id == fd->range.refid);
    //                   pthread_mutex_unlock(&fd->range_lock);
    //                   if  (need_ref) {
    //                       if (!refs[cr->ref_id])
    //                           refs[cr->ref_id] = cram_get_ref(fd, cr->ref_id, 1, 0);
    //                       if (!(s->ref = refs[cr->ref_id]))
    //                           return -1;
    //                   } else {
    //                       // For multi-ref containers, we don't need to fetch all
    //                       // refs if we're only querying one.
    //                       s->ref = NULL;
    //                   }

    //                   pthread_mutex_lock(&fd->range_lock);
    //                   int discard_last_ref = (!fd->unsorted &&
    //                                           last_ref_id >= 0 &&
    //                                           refs[last_ref_id] &&
    //                                           (fd->range.refid == -2 ||
    //                                            last_ref_id == fd->range.refid));
    //                   pthread_mutex_unlock(&fd->range_lock);
    //                   if  (discard_last_ref) {
    //                       cram_ref_decr(fd->refs, last_ref_id);
    //                       refs[last_ref_id] = NULL;
    //                   }
    //               }
    //               s->ref_start = 1;
    //               pthread_mutex_lock(&fd->ref_lock);
    //               pthread_mutex_lock(&fd->refs->lock);
    //               s->ref_end = fd->refs->ref_id[cr->ref_id]->length;
    //               pthread_mutex_unlock(&fd->refs->lock);
    //               pthread_mutex_unlock(&fd->ref_lock);

    //               last_ref_id = cr->ref_id;
    //           }
    //       } else {
    //           cr->ref_id = -1;
    //       }
    //   } else {
    //       cr->ref_id = ref_id; // Forced constant in CRAM 1.0
    //   }
    //   if (cr->ref_id < -1 || cr->ref_id >= bfd->nref) {
    //       hts_log_error("Requested unknown reference ID %d", cr->ref_id);
    //       return -1;
    //   }

    //   if (ds & CRAM_RL) {
    //       if (!c->comp_hdr->codecs[DS_RL]) return -1;
    //       r |= c->comp_hdr->codecs[DS_RL]
    //                       ->decode(s, c->comp_hdr->codecs[DS_RL], blk,
    //                                (char *)&cr->len, &out_sz);
    //       if (r) return r;
    //       if (cr->len < 0) {
    //           hts_log_error("Read has negative length");
    //           return -1;
    //       }
    //   }

    //   if (ds & CRAM_AP) {
    //       if (!c->comp_hdr->codecs[DS_AP]) return -1;
    //       r |= c->comp_hdr->codecs[DS_AP]
    //                       ->decode(s, c->comp_hdr->codecs[DS_AP], blk,
    //                                (char *)&cr->apos, &out_sz);
    //       if (r) return r;
    //       if (c->comp_hdr->AP_delta)
    //           cr->apos += s->last_apos;
    //       s->last_apos=  cr->apos;
    //   } else {
    //       cr->apos = c->ref_seq_start;
    //   }

    //   if (ds & CRAM_RG) {
    //       if (!c->comp_hdr->codecs[DS_RG]) return -1;
    //       r |= c->comp_hdr->codecs[DS_RG]
    //                      ->decode(s, c->comp_hdr->codecs[DS_RG], blk,
    //                               (char *)&cr->rg, &out_sz);
    //       if (r) return r;
    //       if (cr->rg == unknown_rg)
    //           cr->rg = -1;
    //   } else {
    //       cr->rg = -1;
    //   }

    //   cr->name_len = 0;

    //   if (c->comp_hdr->read_names_included) {
    //       int32_t out_sz2 = 1;

    //       // Read directly into name cram_block
    //       cr->name = BLOCK_SIZE(s->name_blk);
    //       if (ds & CRAM_RN) {
    //           if (!c->comp_hdr->codecs[DS_RN]) return -1;
    //           r |= c->comp_hdr->codecs[DS_RN]
    //                           ->decode(s, c->comp_hdr->codecs[DS_RN], blk,
    //                                    (char *)s->name_blk, &out_sz2);
    //           if (r) return r;
    //           cr->name_len = out_sz2;
    //       }
    //   }

    //   cr->mate_pos = 0;
    //   cr->mate_line = -1;
    //   cr->mate_ref_id = -1;
    //   if ((ds & CRAM_CF) && (cf & CRAM_FLAG_DETACHED)) {
    //       if (ds & CRAM_MF) {
    //           if (CRAM_MAJOR_VERS(fd->version) == 1) {
    //               /* MF is byte in 1.0, int32 in 2.0 */
    //               unsigned char mf;
    //               if (!c->comp_hdr->codecs[DS_MF]) return -1;
    //               r |= c->comp_hdr->codecs[DS_MF]
    //                               ->decode(s, c->comp_hdr->codecs[DS_MF],
    //                                        blk, (char *)&mf, &out_sz);
    //               if (r) return r;
    //               cr->mate_flags = mf;
    //           } else {
    //               if (!c->comp_hdr->codecs[DS_MF]) return -1;
    //               r |= c->comp_hdr->codecs[DS_MF]
    //                               ->decode(s, c->comp_hdr->codecs[DS_MF],
    //                                        blk,
    //                                        (char *)&cr->mate_flags,
    //                                        &out_sz);
    //               if (r) return r;
    //           }
    //       } else {
    //           cr->mate_flags = 0;
    //       }

    //       if (!c->comp_hdr->read_names_included) {
    //           int32_t out_sz2 = 1;

    //           // Read directly into name cram_block
    //           cr->name = BLOCK_SIZE(s->name_blk);
    //           if (ds & CRAM_RN) {
    //               if (!c->comp_hdr->codecs[DS_RN]) return -1;
    //               r |= c->comp_hdr->codecs[DS_RN]
    //                               ->decode(s, c->comp_hdr->codecs[DS_RN],
    //                                        blk, (char *)s->name_blk,
    //                                        &out_sz2);
    //               if (r) return r;
    //               cr->name_len = out_sz2;
    //           }
    //       }

    //       if (ds & CRAM_NS) {
    //           if (!c->comp_hdr->codecs[DS_NS]) return -1;
    //           r |= c->comp_hdr->codecs[DS_NS]
    //                           ->decode(s, c->comp_hdr->codecs[DS_NS], blk,
    //                                    (char *)&cr->mate_ref_id, &out_sz);
    //           if (r) return r;
    //       }

    //       // Skip as mate_ref of "*" is legit. It doesn't mean unmapped, just unknown.
    //       // if (cr->mate_ref_id == -1 && cr->flags & 0x01) {
    //       //     /* Paired, but unmapped */
    //       //     cr->flags |= BAM_FMUNMAP;
    //       // }

    //       if (ds & CRAM_NP) {
    //           if (!c->comp_hdr->codecs[DS_NP]) return -1;
    //           r |= c->comp_hdr->codecs[DS_NP]
    //                           ->decode(s, c->comp_hdr->codecs[DS_NP], blk,
    //                                    (char *)&cr->mate_pos, &out_sz);
    //           if (r) return r;
    //       }

    //       if (ds & CRAM_TS) {
    //           if (!c->comp_hdr->codecs[DS_TS]) return -1;
    //           r |= c->comp_hdr->codecs[DS_TS]
    //                           ->decode(s, c->comp_hdr->codecs[DS_TS], blk,
    //                                    (char *)&cr->tlen, &out_sz);
    //           if (r) return r;
    //       } else {
    //           cr->tlen = INT_MIN;
    //       }
    //   } else if ((ds & CRAM_CF) && (cf & CRAM_FLAG_MATE_DOWNSTREAM)) {
    //       if (ds & CRAM_NF) {
    //           if (!c->comp_hdr->codecs[DS_NF]) return -1;
    //           r |= c->comp_hdr->codecs[DS_NF]
    //                           ->decode(s, c->comp_hdr->codecs[DS_NF], blk,
    //                                    (char *)&cr->mate_line, &out_sz);
    //           if (r) return r;
    //           cr->mate_line += rec + 1;

    //           //cr->name_len = sprintf(name, "%d", name_id++);
    //           //cr->name = DSTRING_LEN(name_ds);
    //           //dstring_nappend(name_ds, name, cr->name_len);

    //           cr->mate_ref_id = -1;
    //           cr->tlen = INT_MIN;
    //           cr->mate_pos = 0;
    //       } else  {
    //           cr->mate_flags = 0;
    //           cr->tlen = INT_MIN;
    //       }
    //   } else {
    //       cr->mate_flags = 0;
    //       cr->tlen = INT_MIN;
    //   }
    //   /*
    //   else if (!name[0]) {
    //       //name[0] = '?'; name[1] = 0;
    //       //cr->name_len = 1;
    //       //cr->name=  DSTRING_LEN(s->name_ds);
    //       //dstring_nappend(s->name_ds, "?", 1);

    //       cr->mate_ref_id = -1;
    //       cr->tlen = 0;
    //       cr->mate_pos = 0;
    //   }
    //   */

    //   /* Auxiliary tags */
    //   has_MD = has_NM = 0;
    //   if (CRAM_MAJOR_VERS(fd->version) == 1)
    //       r |= cram_decode_aux_1_0(c, s, blk, cr);
    //   else
    //       r |= cram_decode_aux(c, s, blk, cr, &has_MD, &has_NM);
    //   if (r) return r;

    //   /* Fake up dynamic string growth and appending */
    //   if (ds & CRAM_RL) {
    //       cr->seq = BLOCK_SIZE(s->seqs_blk);
    //       BLOCK_GROW(s->seqs_blk, cr->len);
    //       seq = (char *)BLOCK_END(s->seqs_blk);
    //       BLOCK_SIZE(s->seqs_blk) += cr->len;

    //       if (!seq)
    //           return -1;

    //       cr->qual = BLOCK_SIZE(s->qual_blk);
    //       BLOCK_GROW(s->qual_blk, cr->len);
    //       qual = (char *)BLOCK_END(s->qual_blk);
    //       BLOCK_SIZE(s->qual_blk) += cr->len;

    //       if (!s->ref)
    //           memset(seq, '=', cr->len);
    //   }

    //   if (!(bf & BAM_FUNMAP)) {
    //       if ((ds & CRAM_AP) && cr->apos <= 0) {
    //           hts_log_error("Read has alignment position %d but no unmapped flag",
    //                         cr->apos);
    //           return -1;
    //       }
    //       /* Decode sequence and generate CIGAR */
    //       if (ds & (CRAM_SEQ | CRAM_MQ)) {
    //           r |= cram_decode_seq(fd, c, s, blk, cr, bfd, cf, seq, qual,
    //                                has_MD, has_NM);
    //           if (r) return r;
    //       } else {
    //           cr->cigar = 0;
    //           cr->ncigar = 0;
    //           cr->aend = cr->apos;
    //           cr->mqual = 0;
    //       }
    //   } else {
    //       int out_sz2 = cr->len;

    //       //puts("Unmapped");
    //       cr->cigar = 0;
    //       cr->ncigar = 0;
    //       cr->aend = cr->apos;
    //       cr->mqual = 0;

    //       if (ds & CRAM_BA && cr->len) {
    //           if (!c->comp_hdr->codecs[DS_BA]) return -1;
    //           r |= c->comp_hdr->codecs[DS_BA]
    //                           ->decode(s, c->comp_hdr->codecs[DS_BA], blk,
    //                                    (char *)seq, &out_sz2);
    //           if (r) return r;
    //       }

    //       if ((ds & CRAM_CF) && (cf & CRAM_FLAG_PRESERVE_QUAL_SCORES)) {
    //           out_sz2 = cr->len;
    //           if (ds & CRAM_QS && cr->len >= 0) {
    //               if (!c->comp_hdr->codecs[DS_QS]) return -1;
    //               r |= c->comp_hdr->codecs[DS_QS]
    //                               ->decode(s, c->comp_hdr->codecs[DS_QS],
    //                                        blk, qual, &out_sz2);
    //               if (r) return r;
    //           }
    //       } else {
    //           if (ds & CRAM_RL)
    //               memset(qual, 255, cr->len);
    //       }
    //   }
    // }

    // pthread_mutex_lock(&fd->ref_lock);
    // if (refs) {
    //   int i;
    //   for (i = 0; i < fd->refs->nref; i++) {
    //       if (refs[i])
    //           cram_ref_decr(fd->refs, i);
    //   }
    //   free(refs);
    // } else if (ref_id >= 0 && s->ref != fd->ref_free && !embed_ref) {
    //   cram_ref_decr(fd->refs, ref_id);
    // }
    // pthread_mutex_unlock(&fd->ref_lock);

    // /* Resolve mate pair cross-references between recs within this slice */
    // r |= cram_decode_slice_xref(s, fd->required_fields);

    // // Free the original blocks as we no longer need these.
    // {
    //   int i;
    //   for (i = 0; i < s->hdr->num_blocks; i++) {
    //       cram_block *b = s->block[i];
    //       cram_free_block(b);
    //       s->block[i] = NULL;
    //   }
    // }

    // // read all the blocks in the slice
    // const blocks = new Array(sliceHeader.content.numBlocks)
    // let blockOffset = sliceHeader._endOffset
    // for (let i = 0; i < sliceHeader.content.numBlocks; i += 1) {
    //   blocks[i] = await this.file.readBlock(blockOffset)
    //   blockOffset = blocks[i]._endOffset
    // }

    // console.log(JSON.stringify(blocks, null, '  '))
    // //

    return []
  }
}

module.exports = CramSlice
