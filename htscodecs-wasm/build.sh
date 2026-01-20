#!/bin/bash
set -e

echo "Building htscodecs WASM module..."

# Source emscripten environment if available (local development)
if [ -f ~/emsdk/emsdk_env.sh ]; then
    source ~/emsdk/emsdk_env.sh
fi

# Verify emcc is available
if ! command -v emcc &> /dev/null; then
    echo "Error: emcc not found. Please install Emscripten SDK."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Verify htscodecs source exists
if [ ! -d "htscodecs/htscodecs" ]; then
    echo "Error: htscodecs source not found. Run ./update-htscodecs.sh first."
    exit 1
fi

echo "Compiling with Emscripten..."

# Copy our config.h and version.h to the htscodecs directory
cp "$SCRIPT_DIR/config.h" htscodecs/htscodecs/
cp "$SCRIPT_DIR/version.h" htscodecs/htscodecs/

# Source files we need (excluding SIMD variants)
SOURCES=(
    "htscodecs/htscodecs/arith_dynamic.c"
    "htscodecs/htscodecs/fqzcomp_qual.c"
    "htscodecs/htscodecs/htscodecs.c"
    "htscodecs/htscodecs/pack.c"
    "htscodecs/htscodecs/rANS_static.c"
    "htscodecs/htscodecs/rANS_static4x16pr.c"
    "htscodecs/htscodecs/rANS_static32x16pr.c"
    "htscodecs/htscodecs/rle.c"
    "htscodecs/htscodecs/tokenise_name3.c"
    "htscodecs/htscodecs/utils.c"
    "bz2_wrapper.c"
    "zlib_wrapper.c"
    "cram_codecs.c"
)

# Functions to export
EXPORTS=(
    "_rans_uncompress"
    "_rans_uncompress_4x16"
    "_arith_uncompress"
    "_fqz_decompress"
    "_tok3_decode_names"
    "_bz2_uncompress"
    "_zlib_uncompress"
    "_decode_gamma"
    "_decode_gamma_bulk"
    "_decode_beta"
    "_decode_beta_bulk"
    "_decode_subexp"
    "_decode_subexp_bulk"
    "_read_bits_direct"
    "_malloc"
    "_free"
)

EXPORT_STR=$(printf "'%s'," "${EXPORTS[@]}")
EXPORT_STR="[${EXPORT_STR%,}]"

# Common emcc flags (without ENVIRONMENT, set per-build)
COMMON_FLAGS=(
    -O3
    -flto
    -s WASM=1
    -s MODULARIZE=1
    -s EXPORT_NAME='createHtsCodecsModule'
    -s EXPORTED_FUNCTIONS="$EXPORT_STR"
    -s EXPORTED_RUNTIME_METHODS='["getValue","HEAPU8"]'
    -s ALLOW_MEMORY_GROWTH=1
    -s INITIAL_MEMORY=16MB
    -s MAXIMUM_MEMORY=2GB
    -s SINGLE_FILE=1
    -s USE_BZIP2=1
    -s USE_ZLIB=1
    -s FILESYSTEM=0
    -s TEXTDECODER=2
    -s SUPPORT_LONGJMP=0
    --closure 1
    -I htscodecs
    -I htscodecs/htscodecs
    -DHAVE_BUILTIN_PREFETCH
    -DNDEBUG
)

# Build ESM version (for esm/ directory) - web/worker only, no Node.js require()
echo "Building ESM version..."
emcc "${COMMON_FLAGS[@]}" -s EXPORT_ES6=1 -s ENVIRONMENT='web,worker' "${SOURCES[@]}" -o htscodecs.esm.js

# Build CommonJS version (for dist/ directory) - includes Node.js support
echo "Building CommonJS version..."
emcc "${COMMON_FLAGS[@]}" -s ENVIRONMENT='web,node,worker' "${SOURCES[@]}" -o htscodecs.cjs.js

echo "Build complete!"

# Copy ESM version to src/wasm (used during development and for ESM build)
mkdir -p ../src/wasm
cp htscodecs.esm.js ../src/wasm/htscodecs.js

echo "Copied ESM version to src/wasm/htscodecs.js"
