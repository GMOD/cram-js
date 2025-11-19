#!/bin/bash

set -e

# Parse arguments
BRANCH1=${1:-master}
BRANCH2=${2:-rans_opt}
RUNS=${3:-20}
WARMUP=${4:-3}

echo "=========================================================================="
echo "Benchmarking $BRANCH1 vs $BRANCH2 using hyperfine"
echo "=========================================================================="
echo "Runs: $RUNS, Warmup: $WARMUP"
echo ""

# Check if hyperfine is installed
if ! command -v hyperfine &> /dev/null; then
  echo "Error: hyperfine is not installed"
  echo "Install with: cargo install hyperfine"
  echo "or: brew install hyperfine"
  exit 1
fi

# Current branch
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Original branch: $ORIGINAL_BRANCH"
echo ""

# Create temp directory for builds
TEMP_DIR=$(mktemp -d)
BUILD1="$TEMP_DIR/build-$BRANCH1"
BUILD2="$TEMP_DIR/build-$BRANCH2"

echo "Using temp directory: $TEMP_DIR"
echo ""

# Function to build a branch
build_branch() {
  local branch=$1
  local build_dir=$2

  echo "=========================================================================="
  echo "Building $branch..."
  echo "=========================================================================="
  git checkout "$branch"

  # Clean and build
  yarn build

  # Copy build output
  mkdir -p "$build_dir"
  cp -r dist "$build_dir/"
  cp -r esm "$build_dir/"
  cp package.json "$build_dir/"

  echo "✓ Built $branch to $build_dir"
  echo ""
}

# Build both branches
build_branch "$BRANCH1" "$BUILD1"
build_branch "$BRANCH2" "$BUILD2"

# Switch back to original branch
git checkout "$ORIGINAL_BRANCH"
echo "✓ Switched back to $ORIGINAL_BRANCH"
echo ""

# Run hyperfine benchmark
echo "=========================================================================="
echo "Running benchmark..."
echo "=========================================================================="
echo ""

# Backup current build
if [ -d "dist" ]; then
  mv dist dist.backup
fi
if [ -d "esm" ]; then
  mv esm esm.backup
fi

hyperfine \
  --runs "$RUNS" \
  --warmup "$WARMUP" \
  --prepare "rm -rf dist esm && cp -r $BUILD1/dist . && cp -r $BUILD1/esm ." \
  --export-markdown "benchmark-$BRANCH1-vs-$BRANCH2.md" \
  --export-json "benchmark-$BRANCH1-vs-$BRANCH2.json" \
  --command-name "$BRANCH1" "node benchmarks/benchmark-runner.mjs" \
  --prepare "rm -rf dist esm && cp -r $BUILD2/dist . && cp -r $BUILD2/esm ." \
  --command-name "$BRANCH2" "node benchmarks/benchmark-runner.mjs"

# Restore original build
rm -rf dist esm
if [ -d "dist.backup" ]; then
  mv dist.backup dist
fi
if [ -d "esm.backup" ]; then
  mv esm.backup esm
fi

echo ""
echo "=========================================================================="
echo "Results saved to:"
echo "  - benchmark-$BRANCH1-vs-$BRANCH2.md"
echo "  - benchmark-$BRANCH1-vs-$BRANCH2.json"
echo "=========================================================================="
echo ""

# Clean up
rm -rf "$TEMP_DIR"
echo "✓ Cleaned up temporary files"
