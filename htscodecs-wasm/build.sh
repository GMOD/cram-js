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

# Clone or update htscodecs
if [ ! -d "htscodecs" ]; then
    echo "Cloning htscodecs..."
    git clone --depth 1 https://github.com/samtools/htscodecs.git
else
    echo "Updating htscodecs..."
    cd htscodecs
    git pull
    cd ..
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
)

# Functions to export
EXPORTS=(
    "_rans_uncompress"
    "_rans_uncompress_4x16"
    "_arith_uncompress"
    "_fqz_decompress"
    "_tok3_decode_names"
    "_malloc"
    "_free"
)

EXPORT_STR=$(printf "'%s'," "${EXPORTS[@]}")
EXPORT_STR="[${EXPORT_STR%,}]"

emcc \
    -O3 \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createHtsCodecsModule' \
    -s EXPORTED_FUNCTIONS="$EXPORT_STR" \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAPU8","HEAP32"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=16MB \
    -s MAXIMUM_MEMORY=2GB \
    -s ENVIRONMENT='web,node,worker' \
    -s SINGLE_FILE=1 \
    -I htscodecs \
    -I htscodecs/htscodecs \
    -DHAVE_BUILTIN_PREFETCH \
    "${SOURCES[@]}" \
    -o htscodecs.js

echo "Build complete!"

# Copy to src/wasm
mkdir -p ../src/wasm
cp htscodecs.js ../src/wasm/htscodecs.js

echo "Copied to src/wasm/htscodecs.js"
