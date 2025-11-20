# CRAM v3.1 Format Specification Summary

Source: https://github.com/samtools/hts-specs/blob/master/CRAMv3.tex
Generated: 2025-11-19

## Overview

The CRAM format is a reference-based compression scheme for genomic sequence data. Version 3.1 represents the latest iteration, building upon version 3.0 with "additional EXTERNAL compression codecs only."

## Core Data Organization

**File Structure:**
A CRAM file consists of: file definition (26 bytes) → CRAM header container → zero or more data containers → end-of-file container.

**Containers and Blocks:**
Containers hold multiple blocks. The first block in each data container is the compression header, followed by slices. Each slice comprises a header block, core data block, and external data blocks.

## Record Encoding

Records begin with two flag fields:

- **BAM bit flags (BF):** Standard SAM/BAM alignment flags indicating unmapped status, strand orientation, and pair relationships
- **CRAM bit flags (CF):** Compression-specific flags indicating quality storage format, mate detachment, downstream mate presence, and unknown sequence notation

Following flags, records encode: positional data (reference ID, alignment position, read length), read names, mate information, auxiliary tags, and sequences.

## Key Data Series

The specification defines these primary data series with dedicated encodings:

| Series | Purpose |
|--------|---------|
| RI | Reference sequence ID (multi-ref slices) |
| RL | Read length |
| AP | Alignment position (delta or absolute) |
| FN | Number of read features |
| MQ | Mapping quality |
| BA | Bases (unmapped reads) |
| QS | Quality scores |

## Compression Methods

Block-level compression supports: raw, gzip, bzip2, lzma (v3.0), rans4x8 (v3.0), rans4x16 (v3.1), arithmetic coder (v3.1), fqzcomp (v3.1), and name tokenizer (v3.1).

## Encoding Schemes

**Bit-stream encodings** (core data):
- **HUFFMAN (ID 3):** Variable-length codes with canonical computation
- **BETA (ID 6):** Fixed-bit binary representation
- **SUBEXP (ID 7):** Logarithmic growth for larger values

**Byte-stream encodings** (external data):
- **EXTERNAL (ID 1):** Verbatim storage to external blocks
- **BYTE_ARRAY_LEN (ID 4):** Length-prefixed arrays
- **BYTE_ARRAY_STOP (ID 5):** Delimiter-terminated arrays

## Mapped vs. Unmapped Reads

**Mapped reads** encode differences from reference via read features (substitutions, insertions, deletions, soft clips). A substitution matrix efficiently represents base changes using 2-bit codes.

**Unmapped reads** store complete bases and quality scores directly without reference compression.

## Reference Requirements

MD5 checksums for reference sequences are mandatory in slice headers. The specification requires "all CRAM reader implementations are expected to check for reference MD5 checksums."

## Indexing

CRAM indexing operates at slice granularity through external gzipped index files containing: reference ID, alignment coordinates, byte offsets, and slice size. Multi-reference slices may require multiple index entries.
