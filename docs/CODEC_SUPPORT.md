# CRAM Codec Support

All CRAM v3 and v3.1 codecs are supported.

## Block-level compression

| ID  | Method   | Supported                                                                  |
| --- | -------- | -------------------------------------------------------------------------- |
| 0   | raw      | ✅                                                                         |
| 1   | gzip     | ✅                                                                         |
| 2   | bzip2    | ✅                                                                         |
| 3   | lzma     | ✅                                                                         |
| 4   | rans     | ✅                                                                         |
| 5   | rans4x16 | ✅ all sub-variants (order-0/1, Pack, RLE, r32x16, striped, CAT, gzip-min) |
| 6   | arith    | ✅                                                                         |
| 7   | fqzcomp  | ✅                                                                         |
| 8   | tok3     | ✅ all sub-variants (tok3-rans, tok3-arith)                                |

### htscodecs and other libraries usage

We use [samtools/htscodecs](https://github.com/samtools/htscodecs) via
Emscripten (`htscodecs-wasm/build.sh`), checked in as inlined base64 at
`src/wasm/htscodecs.js`. To update: `htscodecs-wasm/update-htscodecs.sh` then
`./build.sh`. All the above codecs come from htscodecs except xz-decompress
which is vendored from https://github.com/httptoolkit/xz-decompress

## Data-series codecs

| ID  | Codec           | Supported                                   |
| --- | --------------- | ------------------------------------------- |
| 1   | External        | ✅                                          |
| 2   | Golomb          | ❌ CRAM v2-era, not emitted by modern tools |
| 3   | Huffman         | ✅                                          |
| 4   | ByteArrayLength | ✅                                          |
| 5   | ByteArrayStop   | ✅                                          |
| 6   | Beta            | ✅                                          |
| 7   | SubExp          | ✅                                          |
| 8   | Golomb-Rice     | ❌ CRAM v2-era, not emitted by modern tools |
| 9   | Gamma           | ✅                                          |
