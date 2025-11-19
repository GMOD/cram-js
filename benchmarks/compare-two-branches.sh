#!/bin/bash

set -e

# Parse arguments
BRANCH1=${1:-init2}
BRANCH2=${2:-init3}

echo "=========================================================================="
echo "Comparing $BRANCH1 vs $BRANCH2"
echo "=========================================================================="
echo ""

# Current branch
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Original branch: $ORIGINAL_BRANCH"
echo ""

# Function to profile a branch
profile_branch() {
  local branch=$1
  local output_file=$2

  echo "=========================================================================="
  echo "Profiling $branch..."
  echo "=========================================================================="
  git checkout "$branch"
  yarn test profile --run
  if [ -f "SRR396637-parsing.cpuprofile" ]; then
    mv SRR396637-parsing.cpuprofile "$output_file"
    echo "✓ Saved $branch profile to $output_file"
  else
    echo "✗ Error: Profile not generated for $branch"
    git checkout "$ORIGINAL_BRANCH"
    exit 1
  fi
  echo ""
}

# Profile both branches
profile_branch "$BRANCH1" "SRR396637-parsing-$BRANCH1.cpuprofile"
profile_branch "$BRANCH2" "SRR396637-parsing-$BRANCH2.cpuprofile"

# Switch back to original branch
git checkout "$ORIGINAL_BRANCH"
echo "✓ Switched back to $ORIGINAL_BRANCH"
echo ""

# Analyze profiles
echo "=========================================================================="
echo "Analyzing profiles..."
echo "=========================================================================="
node analyze-profile.mjs "SRR396637-parsing-$BRANCH1.cpuprofile" > "profile-$BRANCH1.txt"
node analyze-profile.mjs "SRR396637-parsing-$BRANCH2.cpuprofile" > "profile-$BRANCH2.txt"
echo "✓ Analysis complete"
echo ""

# Create comparison report
echo "=========================================================================="
echo "Generating comparison..."
echo "=========================================================================="

cat > compare-temp.mjs <<EOF
import { readFileSync } from 'fs'

const branch1Text = readFileSync('profile-$BRANCH1.txt', 'utf-8')
const branch2Text = readFileSync('profile-$BRANCH2.txt', 'utf-8')

function extractMetrics(text) {
  const samplesMatch = text.match(/Total samples: (\d+)/)
  const timeMatch = text.match(/Total time \\(μs\\): (\d+)/)

  return {
    samples: samplesMatch ? parseInt(samplesMatch[1]) : 0,
    totalTime: timeMatch ? parseInt(timeMatch[1]) : 0,
  }
}

const branch1 = extractMetrics(branch1Text)
const branch2 = extractMetrics(branch2Text)

console.log('PERFORMANCE COMPARISON')
console.log('='.repeat(80))
console.log()
console.log('$BRANCH1:')
console.log(\`  Total time: \${(branch1.totalTime / 1000).toFixed(0)}ms\`)
console.log(\`  Samples: \${branch1.samples.toLocaleString()}\`)
console.log()
console.log('$BRANCH2:')
console.log(\`  Total time: \${(branch2.totalTime / 1000).toFixed(0)}ms\`)
console.log(\`  Samples: \${branch2.samples.toLocaleString()}\`)
console.log()

const timeDiff = branch2.totalTime - branch1.totalTime
const pctChange = ((timeDiff / branch1.totalTime) * 100).toFixed(1)
const speedup = (branch1.totalTime / branch2.totalTime).toFixed(3)

console.log('='.repeat(80))
console.log('RESULT:')
console.log(\`  Time difference: \${timeDiff > 0 ? '+' : ''}\${(timeDiff / 1000).toFixed(0)}ms (\${pctChange > 0 ? '+' : ''}\${pctChange}%)\`)

if (timeDiff < 0) {
  console.log(\`  ✓ IMPROVEMENT: \${speedup}x faster\`)
  console.log(\`  Time saved: \${Math.abs(timeDiff / 1000).toFixed(0)}ms per run\`)
} else if (timeDiff > 0) {
  console.log(\`  ✗ REGRESSION: \${(branch2.totalTime / branch1.totalTime).toFixed(3)}x slower\`)
  console.log(\`  Time lost: \${(timeDiff / 1000).toFixed(0)}ms per run\`)
} else {
  console.log(\`  → No significant change\`)
}
console.log('='.repeat(80))
console.log()
EOF

node compare-temp.mjs
rm compare-temp.mjs

echo ""
echo "=========================================================================="
echo "Comparison complete!"
echo "=========================================================================="
echo ""
echo "Files:"
echo "  - SRR396637-parsing-$BRANCH1.cpuprofile"
echo "  - SRR396637-parsing-$BRANCH2.cpuprofile"
echo "  - profile-$BRANCH1.txt"
echo "  - profile-$BRANCH2.txt"
echo ""
echo "To see detailed diff:"
echo "  diff -y profile-$BRANCH1.txt profile-$BRANCH2.txt | less"
echo ""
