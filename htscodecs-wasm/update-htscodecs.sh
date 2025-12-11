#!/bin/bash
# Script to update the vendored htscodecs source from upstream
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Updating htscodecs from https://github.com/samtools/htscodecs..."

# Clone to a temp directory
TEMP_DIR=$(mktemp -d)
git clone --depth 1 https://github.com/samtools/htscodecs.git "$TEMP_DIR"

# Get the commit hash for reference
COMMIT_HASH=$(cd "$TEMP_DIR" && git rev-parse HEAD)
echo "Latest commit: $COMMIT_HASH"

# Remove old htscodecs directory (except .git if it exists)
rm -rf htscodecs

# Copy the new source
cp -r "$TEMP_DIR" htscodecs

# Remove the .git directory from the copy
rm -rf htscodecs/.git

# Clean up
rm -rf "$TEMP_DIR"

# Update the version in our config
VERSION=$(grep "AC_INIT" htscodecs/configure.ac | sed -n 's/.*AC_INIT(htscodecs, \([0-9.]*\)).*/\1/p')
echo "htscodecs version: $VERSION"

# Update version.h
cat > version.h << EOF
/* version.h for htscodecs WASM build */
/* Updated from https://github.com/samtools/htscodecs commit $COMMIT_HASH */
#define HTSCODECS_VERSION_TEXT "$VERSION"
EOF

echo "Done! htscodecs updated to version $VERSION (commit $COMMIT_HASH)"
echo "Remember to rebuild with ./build.sh"
