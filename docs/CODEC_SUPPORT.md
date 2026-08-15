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

### Where these come from

All of the above are [samtools/htscodecs](https://github.com/samtools/htscodecs)
compiled with emscripten (`htscodecs-wasm/build.sh`) and checked in as an
inlined bundle at `src/wasm/htscodecs.js`. To update it, run
`htscodecs-wasm/update-htscodecs.sh` and then `./build.sh`.

The exception is lzma, which htscodecs does not implement. That one is
[xz-decompress](https://github.com/httptoolkit/xz-decompress), vendored into
`src/xz-decompress/` as a second, much smaller wasm module.

For what the wasm costs in bundle size, startup and memory — and why only the
lzma module is base64 — see [WASM.md](WASM.md).

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
