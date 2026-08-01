#!/bin/bash
# Script to update the vendored libdeflate source from upstream
set -e

VERSION="${1:-v1.25}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Updating libdeflate ($VERSION) from https://github.com/ebiggers/libdeflate..."

TEMP_DIR=$(mktemp -d)
git clone --quiet --depth 1 --branch "$VERSION" \
    https://github.com/ebiggers/libdeflate.git "$TEMP_DIR"

COMMIT_HASH=$(cd "$TEMP_DIR" && git rev-parse HEAD)
echo "Commit: $COMMIT_HASH"

rm -rf libdeflate
cp -r "$TEMP_DIR" libdeflate
rm -rf "$TEMP_DIR"

# Only the library sources are used. The CLI programs, benchmark scripts and
# cmake plumbing are never compiled, and upstream's own CI config has no
# business running (or sitting) in this repo.
rm -rf libdeflate/.git libdeflate/.github libdeflate/.cirrus.yml \
       libdeflate/.gitignore libdeflate/programs libdeflate/scripts \
       libdeflate/CMakeLists.txt libdeflate/libdeflate-config.cmake.in \
       libdeflate/libdeflate.pc.in

grep LIBDEFLATE_VERSION_STRING libdeflate/libdeflate.h

echo "Done! Remember to rebuild with ./build.sh"
