#!/bin/bash

set -e

echo "=========================================================================="
echo "CRAM-JS Performance Comparison: Current Branch vs Master"
echo "=========================================================================="
echo ""

# Save current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"
echo ""

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "WARNING: You have uncommitted changes."
  echo "Please commit or stash your changes before running this comparison."
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "=========================================================================="
echo "Step 1: Running profile on CURRENT branch ($CURRENT_BRANCH)"
echo "=========================================================================="
echo ""

yarn test profile --run
if [ -f "SRR396637-parsing.cpuprofile" ]; then
  mv SRR396637-parsing.cpuprofile SRR396637-parsing-current.cpuprofile
  echo "✓ Saved profile as SRR396637-parsing-current.cpuprofile"
else
  echo "✗ Error: Profile not generated"
  exit 1
fi

echo ""
echo "Analyzing current branch profile..."
node analyze-profile-generic.mjs SRR396637-parsing-current.cpuprofile >profile-current.txt
echo "✓ Saved analysis to profile-current.txt"
echo ""

echo "=========================================================================="
echo "Step 2: Stashing profile scripts and switching to MASTER branch"
echo "=========================================================================="
echo ""

# Stash the benchmark/profile test files if they exist
echo "Temporarily saving benchmark and profile scripts..."
mkdir -p /tmp/cram-scripts-temp
[ -d "benchmarks" ] && cp -r benchmarks /tmp/cram-scripts-temp/ || true
[ -f "test/profile.test.ts" ] && cp test/profile.test.ts /tmp/cram-scripts-temp/ || true
[ -f "test/profile-longreads.test.ts" ] && cp test/profile-longreads.test.ts /tmp/cram-scripts-temp/ || true
cp analyze-profile-generic.mjs /tmp/cram-scripts-temp/ 2>/dev/null || true
echo "✓ Saved scripts to /tmp"

git checkout master
echo "✓ Switched to master"

# Copy benchmark and profile scripts to master if they don't exist
echo "Copying benchmark and profile scripts from current branch..."
[ -d "/tmp/cram-scripts-temp/benchmarks" ] && cp -r /tmp/cram-scripts-temp/benchmarks . || true
[ -f "/tmp/cram-scripts-temp/profile.test.ts" ] && cp /tmp/cram-scripts-temp/profile.test.ts test/ || true
[ -f "/tmp/cram-scripts-temp/profile-longreads.test.ts" ] && cp /tmp/cram-scripts-temp/profile-longreads.test.ts test/ || true
[ -f "/tmp/cram-scripts-temp/analyze-profile-generic.mjs" ] && cp /tmp/cram-scripts-temp/analyze-profile-generic.mjs . || true
echo "✓ Scripts available on master"
echo ""

echo "=========================================================================="
echo "Step 3: Running profile on MASTER branch"
echo "=========================================================================="
echo ""

yarn test profile --run
if [ -f "SRR396637-parsing.cpuprofile" ]; then
  mv SRR396637-parsing.cpuprofile SRR396637-parsing-master.cpuprofile
  echo "✓ Saved profile as SRR396637-parsing-master.cpuprofile"
else
  echo "✗ Error: Profile not generated"
  git checkout "$CURRENT_BRANCH"
  exit 1
fi

echo ""
echo "Analyzing master branch profile..."
node analyze-profile-generic.mjs SRR396637-parsing-master.cpuprofile >profile-master.txt
echo "✓ Saved analysis to profile-master.txt"
echo ""

echo "=========================================================================="
echo "Step 4: Cleaning up and switching back to $CURRENT_BRANCH"
echo "=========================================================================="
echo ""

# Clean up temporary files from master if we copied them
if [ -d "/tmp/cram-scripts-temp" ]; then
  echo "Cleaning up temporary files from master..."
  git checkout master 2>/dev/null || true
  rm -rf benchmarks test/profile.test.ts test/profile-longreads.test.ts analyze-profile-generic.mjs 2>/dev/null || true
  git checkout -- . 2>/dev/null || true
  echo "✓ Cleaned up master branch"
fi

git checkout "$CURRENT_BRANCH"
echo "✓ Switched back to $CURRENT_BRANCH"

# Remove temporary directory
if [ -d "/tmp/cram-scripts-temp" ]; then
  rm -rf /tmp/cram-scripts-temp 2>/dev/null || true
fi
echo ""

echo "=========================================================================="
echo "Step 5: Generating comparison report"
echo "=========================================================================="
echo ""

# Create comparison script
cat >compare-results.mjs <<'EOF'
import { readFileSync } from 'fs'

const currentText = readFileSync('profile-current.txt', 'utf-8')
const masterText = readFileSync('profile-master.txt', 'utf-8')

function extractMetrics(text) {
  const samplesMatch = text.match(/Total samples: (\d+)/)
  const timeMatch = text.match(/Total time \(μs\): (\d+)/)
  const secondsMatch = text.match(/Total time \(seconds\): ([\d.]+)/)

  return {
    samples: samplesMatch ? parseInt(samplesMatch[1]) : 0,
    totalTime: timeMatch ? parseInt(timeMatch[1]) : 0,
    seconds: secondsMatch ? parseFloat(secondsMatch[1]) : 0,
  }
}

const current = extractMetrics(currentText)
const master = extractMetrics(masterText)

console.log('PERFORMANCE COMPARISON')
console.log('='.repeat(80))
console.log()
console.log('MASTER BRANCH:')
console.log(`  Total time: ${(master.totalTime / 1000).toFixed(0)}ms (${master.seconds.toFixed(2)}s)`)
console.log(`  Samples: ${master.samples.toLocaleString()}`)
console.log()
console.log('CURRENT BRANCH:')
console.log(`  Total time: ${(current.totalTime / 1000).toFixed(0)}ms (${current.seconds.toFixed(2)}s)`)
console.log(`  Samples: ${current.samples.toLocaleString()}`)
console.log()

const timeDiff = current.totalTime - master.totalTime
const pctChange = ((timeDiff / master.totalTime) * 100).toFixed(1)
const speedup = (master.totalTime / current.totalTime).toFixed(2)

console.log('='.repeat(80))
console.log('RESULT:')
console.log(`  Time difference: ${timeDiff > 0 ? '+' : ''}${(timeDiff / 1000).toFixed(0)}ms (${pctChange > 0 ? '+' : ''}${pctChange}%)`)

if (timeDiff < 0) {
  console.log(`  ✓ IMPROVEMENT: ${speedup}x faster`)
  console.log(`  Time saved: ${Math.abs(timeDiff / 1000).toFixed(0)}ms per run`)
} else if (timeDiff > 0) {
  console.log(`  ✗ REGRESSION: ${(current.totalTime / master.totalTime).toFixed(2)}x slower`)
  console.log(`  Time lost: ${(timeDiff / 1000).toFixed(0)}ms per run`)
} else {
  console.log(`  → No significant change`)
}
console.log('='.repeat(80))
console.log()

console.log('DETAILED PROFILES:')
console.log('  Master: profile-master.txt')
console.log('  Current: profile-current.txt')
console.log()
console.log('To see detailed hotspot comparison, run:')
console.log('  diff -y profile-master.txt profile-current.txt | less')
console.log()
EOF

node compare-results.mjs

echo ""
echo "=========================================================================="
echo "Comparison complete!"
echo "=========================================================================="
echo ""
echo "Files generated:"
echo "  - SRR396637-parsing-master.cpuprofile (master branch profile)"
echo "  - SRR396637-parsing-current.cpuprofile (current branch profile)"
echo "  - profile-master.txt (master analysis)"
echo "  - profile-current.txt (current analysis)"
echo ""
