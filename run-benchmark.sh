#!/bin/bash

BRANCH=$1
ITERATIONS=${2:-10}

echo "Running $BRANCH branch $ITERATIONS times..."
echo ""

git checkout "$BRANCH" 2>&1 | head -1

TIMES=()

for i in $(seq 1 $ITERATIONS); do
  echo -n "Run $i: "
  OUTPUT=$(yarn test profile-longreads --run 2>&1)
  TIME=$(echo "$OUTPUT" | grep "✓ generate CPU profile for longreads parsing" | grep -oP '\d+(?=ms)')
  if [ -n "$TIME" ]; then
    echo "${TIME}ms"
    TIMES+=($TIME)
  else
    echo "FAILED"
  fi
done

echo ""
echo "Results for $BRANCH:"
echo "-------------------"

# Calculate statistics
if [ ${#TIMES[@]} -gt 0 ]; then
  # Sort times
  IFS=$'\n' SORTED=($(sort -n <<<"${TIMES[*]}"))
  unset IFS

  # Calculate sum
  SUM=0
  for t in "${TIMES[@]}"; do
    SUM=$((SUM + t))
  done

  # Calculate mean
  MEAN=$((SUM / ${#TIMES[@]}))

  # Get median
  MID=$((${#TIMES[@]} / 2))
  if [ $((${#TIMES[@]} % 2)) -eq 0 ]; then
    MEDIAN=$(((SORTED[MID-1] + SORTED[MID]) / 2))
  else
    MEDIAN=${SORTED[MID]}
  fi

  # Get min and max
  MIN=${SORTED[0]}
  MAX=${SORTED[-1]}

  echo "Runs: ${#TIMES[@]}"
  echo "Mean: ${MEAN}ms"
  echo "Median: ${MEDIAN}ms"
  echo "Min: ${MIN}ms"
  echo "Max: ${MAX}ms"
  echo "Range: $((MAX - MIN))ms"

  # Output raw data for further analysis
  echo ""
  echo "Raw times: ${TIMES[*]}"
else
  echo "No successful runs"
fi
