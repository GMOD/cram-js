#!/bin/bash

# Run multiple profiling comparisons to reduce variance
NUM_RUNS=5

echo "Running ${NUM_RUNS} profiling comparisons to measure variance..."
echo ""

MASTER_TIMES=()
CURRENT_TIMES=()

for i in $(seq 1 $NUM_RUNS); do
  echo "=========================================="
  echo "Run $i of $NUM_RUNS"
  echo "=========================================="

  # Profile current branch
  echo "Profiling current branch..."
  yarn test profile > /dev/null 2>&1
  if [ -f "SRR396637-parsing.cpuprofile" ]; then
    mv SRR396637-parsing.cpuprofile "SRR396637-parsing-current-$i.cpuprofile"
    CURRENT_TIME=$(node analyze-profile-generic.mjs "SRR396637-parsing-current-$i.cpuprofile" | grep "Total time (μs):" | awk '{print $4}')
    CURRENT_TIMES+=($CURRENT_TIME)
    echo "Current: ${CURRENT_TIME}μs"
  fi

  # Switch to master
  git stash -q > /dev/null 2>&1
  git checkout master -q

  # Profile master branch
  echo "Profiling master branch..."
  yarn test profile > /dev/null 2>&1
  if [ -f "SRR396637-parsing.cpuprofile" ]; then
    mv SRR396637-parsing.cpuprofile "SRR396637-parsing-master-$i.cpuprofile"
    MASTER_TIME=$(node analyze-profile-generic.mjs "SRR396637-parsing-master-$i.cpuprofile" | grep "Total time (μs):" | awk '{print $4}')
    MASTER_TIMES+=($MASTER_TIME)
    echo "Master: ${MASTER_TIME}μs"
  fi

  # Switch back
  git checkout init2 -q
  git stash pop -q > /dev/null 2>&1

  echo ""
done

echo "=========================================="
echo "RESULTS SUMMARY"
echo "=========================================="
echo ""

# Calculate statistics
calc_stats() {
  local arr=("$@")
  local sum=0
  local min=${arr[0]}
  local max=${arr[0]}

  for val in "${arr[@]}"; do
    sum=$((sum + val))
    if [ $val -lt $min ]; then min=$val; fi
    if [ $val -gt $max ]; then max=$val; fi
  done

  local avg=$((sum / ${#arr[@]}))
  echo "$avg $min $max"
}

MASTER_STATS=($(calc_stats "${MASTER_TIMES[@]}"))
CURRENT_STATS=($(calc_stats "${CURRENT_TIMES[@]}"))

MASTER_AVG=${MASTER_STATS[0]}
MASTER_MIN=${MASTER_STATS[1]}
MASTER_MAX=${MASTER_STATS[2]}

CURRENT_AVG=${CURRENT_STATS[0]}
CURRENT_MIN=${CURRENT_STATS[1]}
CURRENT_MAX=${CURRENT_STATS[2]}

echo "MASTER BRANCH:"
echo "  Average: $((MASTER_AVG / 1000))ms"
echo "  Range:   $((MASTER_MIN / 1000))ms - $((MASTER_MAX / 1000))ms"
echo ""

echo "CURRENT BRANCH (init2):"
echo "  Average: $((CURRENT_AVG / 1000))ms"
echo "  Range:   $((CURRENT_MIN / 1000))ms - $((CURRENT_MAX / 1000))ms"
echo ""

DIFF=$((MASTER_AVG - CURRENT_AVG))
PCT=$(echo "scale=1; ($DIFF * 100) / $MASTER_AVG" | bc)
SPEEDUP=$(echo "scale=2; $MASTER_AVG / $CURRENT_AVG" | bc)

echo "=========================================="
echo "IMPROVEMENT:"
echo "  Time saved: $((DIFF / 1000))ms (-${PCT}%)"
echo "  Speedup: ${SPEEDUP}x faster"
echo "=========================================="
