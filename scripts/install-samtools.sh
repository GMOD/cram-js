#!/usr/bin/env bash
# Builds samtools from source and installs it to /usr/local/bin.
#
# Ubuntu's apt repo lags upstream by years — noble ships 1.19.2, which predates
# htslib's own TLEN tie-break fix (samtools/htslib commit 4ec8b744, first in
# 1.23): test/samtoolsAgreement.test.ts compares our decoder against whatever
# `samtools` is on PATH, so an apt install makes that comparison test against
# a samtools htslib's own maintainer called "incorrect" for exactly the
# tie-break case test/data/xx#repeated.tmp.cram exercises.
set -euo pipefail

VERSION=1.23.1
SHA256=32266198a4bc6a6df395d8526688c9697d9c8e472f888c749fdde2e08ea88dd2

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

curl -fsSL "https://github.com/samtools/samtools/releases/download/${VERSION}/samtools-${VERSION}.tar.bz2" \
  -o "$workdir/samtools.tar.bz2"
echo "${SHA256}  $workdir/samtools.tar.bz2" | sha256sum -c -

tar xjf "$workdir/samtools.tar.bz2" -C "$workdir"
(
  cd "$workdir/samtools-${VERSION}"
  ./configure
  make -j"$(nproc)"
  sudo make install
)
