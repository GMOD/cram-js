#!/bin/bash
set -e

cd "$(dirname "$0")/../crate"

echo "Building WASM..."
cargo build --release --target wasm32-unknown-unknown

echo "Generating JS bindings..."
wasm-bindgen --target bundler --out-dir ../src/wasm target/wasm32-unknown-unknown/release/inflate_wasm.wasm

echo "Bundling with webpack..."
cd ..
npx webpack --config crate/webpack.config.js

echo "WASM build complete!"
