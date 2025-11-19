#!/bin/bash

set -e

echo "=========================================================================="
echo "Comparing init2 vs init3"
echo "=========================================================================="
echo ""

# Current branch should be init3
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"
echo ""

if [ "$CURRENT_BRANCH" != "init3" ]; then
  echo "ERROR: Please run this from init3 branch"
  exit 1
fi

echo "Step 1: Profiling init3 (current)..."
yarn test profile --run
if [ -f "SRR396637-parsing.cpuprofile" ]; then
  mv SRR396637-parsing.cpuprofile SRR396637-parsing-init3.cpuprofile
  echo "✓ Saved init3 profile"
else
  echo "✗ Error: Profile not generated"
  exit 1
fi

echo ""
echo "Step 2: Switching to init2..."
git checkout init2

echo ""
echo "Step 3: Profiling init2..."
yarn test profile --run
if [ -f "SRR396637-parsing.cpuprofile" ]; then
  mv SRR396637-parsing.cpuprofile SRR396637-parsing-init2.cpuprofile
  echo "✓ Saved init2 profile"
else
  echo "✗ Error: Profile not generated"
  git checkout init3
  exit 1
fi

echo ""
echo "Step 4: Switching back to init3..."
git checkout init3

echo ""
echo "Step 5: Analyzing profiles..."
node analyze-profile.mjs SRR396637-parsing-init2.cpuprofile > profile-init2.txt
node analyze-profile.mjs SRR396637-parsing-init3.cpuprofile > profile-init3.txt

echo ""
echo "Step 6: Comparing results..."
node compare-d04-optimization.mjs

echo ""
echo "=========================================================================="
echo "Comparison complete!"
echo "=========================================================================="
echo ""
echo "Files:"
echo "  - SRR396637-parsing-init2.cpuprofile"
echo "  - SRR396637-parsing-init3.cpuprofile"
echo "  - profile-init2.txt"
echo "  - profile-init3.txt"
echo ""
