#!/bin/bash
echo "Running 3 profiles on current branch to measure variance..."
echo ""

for i in 1 2 3; do
  echo "Run $i:"
  yarn test profile 2>&1 | grep "test/profile.test.ts"
  echo ""
done
