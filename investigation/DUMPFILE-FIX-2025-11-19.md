# dumpWholeFile Test Utility Fix - 2025-11-19

## Summary

Fixed critical bug in `test/lib/dumpFile.ts` that caused it to miss slices when dumping CRAM containers.

---

## Issue

The `dumpWholeFile` test utility was missing slices in certain CRAM files:
- `c1#noseq.tmp.cram`: Found 7/9 records (missing 2)
- `ce#1000.tmp.cram`: Found 602/1000 records (missing 398)

### Tests Affected
- ❌ `test/investigate-noseq.test.ts` - Expected 9, got 7
- ❌ `test/investigate-ce1000.test.ts` - Expected 1000, got 602
- ✅ `test/samtools-validation-snapshots.test.ts` - All 169 tests passed (files with simpler structures)

---

## Root Cause

The bug was in the block iteration logic in `dumpContainerById`:

```typescript
// BEFORE (BUGGY CODE)
for (let blockNum = 0; blockNum < numBlocks; blockNum += 1) {
  const block = await file.readBlock(blockPosition)
  if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
    const slice = await dumpSlice(...)
    data.push(slice)
    blockNum += slice.header.parsedContent.numBlocks  // ❌ Only incremented counter!
  }
  blockPosition = block._endPosition  // ❌ Still reading next sequential block
}
```

### The Problem

The code was incrementing the loop counter (`blockNum`) to skip blocks, but **not actually advancing the file position** (`blockPosition`). This meant:

1. When we found a slice header at block 0 with 8 data blocks
2. We incremented `blockNum` by 8 (making it 8)
3. The loop incremented it to 9
4. **But we were still reading blocks sequentially!**
5. Block 9 in the iteration was actually block 1 in the file (the first data block of the slice we just processed)
6. We never reached the next slice header

### Why Some Tests Passed

The bug only manifested in files where:
- Containers have multiple slices
- Slices have many data blocks
- The total block count would cause the loop to terminate before finding all slices

Simple files with one slice per container worked fine because there were no blocks to skip.

---

## Fix Applied

**File:** `test/lib/dumpFile.ts`

Added actual block position advancement when skipping slice data blocks:

```typescript
// AFTER (FIXED CODE)
for (let blockNum = 0; blockNum < numBlocks; blockNum += 1) {
  let block = await file.readBlock(blockPosition)  // Changed const to let
  if (block.contentType === 'MAPPED_SLICE_HEADER' || block.contentType === 'UNMAPPED_SLICE_HEADER') {
    const slice = await dumpSlice(...)
    data.push(slice)

    // ✅ Actually skip the data blocks by reading and advancing position
    const numSliceBlocks = slice.header.parsedContent.numBlocks
    for (let i = 0; i < numSliceBlocks; i++) {
      blockPosition = block._endPosition
      block = await file.readBlock(blockPosition)
    }
    blockNum += numSliceBlocks  // Also increment counter
  }
  blockPosition = block._endPosition
}
```

### Key Changes

1. Changed `const block` to `let block` to allow reassignment
2. Added inner loop to **actually read and skip** the data blocks
3. Advances `blockPosition` for each skipped block
4. Keeps the counter increment for loop control

---

## Results

### Before Fix
- `investigate-noseq.test.ts`: ❌ 7/9 records
- `investigate-ce1000.test.ts`: ❌ 602/1000 records
- `samtools-validation-snapshots.test.ts`: ✅ 169/169 tests

### After Fix
- `investigate-noseq.test.ts`: ✅ 9/9 records
- `investigate-ce1000.test.ts`: ✅ 1000/1000 records
- `samtools-validation-snapshots.test.ts`: ✅ 169/169 tests (no regressions)

---

## Test Validation

Ran comprehensive test suite to ensure no regressions:

```bash
# All originally failing tests now pass
yarn test indexedfile.test.ts investigate-ce1000-containers \
  investigate-ce1000.test investigate-noseq.test
# Result: ✅ 4 test files, 86 tests passed

# All validation tests still pass
yarn test samtools-validation-snapshots
# Result: ✅ 169/169 tests passed

# Full test suite
yarn test
# Result: ✅ 203 test files, 598 tests passed
```

---

## Technical Details

### CRAM Slice Structure

A CRAM slice consists of:
- 1 slice header block
- N data blocks (1 core + M external)

The slice header's `numBlocks` field contains **only the count of data blocks** (not including the header itself).

Example:
- Slice header says `numBlocks = 8`
- Actual blocks: 1 header + 8 data = 9 total blocks
- Blocks 0-8 belong to this slice
- Block 9 is the next slice header (or other content)

### Why the Bug Was Subtle

The original code worked for simple cases because:
- If a container has only 1 slice, there's nothing to skip
- If slices are small, the loop might terminate naturally
- The counter increment prevented infinite loops

But for complex files with multiple slices and many blocks per slice, the loop would:
1. Process first slice correctly
2. Skip counter ahead (but not position)
3. Read data blocks thinking they were container-level blocks
4. Eventually terminate without finding remaining slices

---

## Files Modified

1. `test/lib/dumpFile.ts` - Fixed block iteration logic

---

## Impact

- ✅ All investigation tests now pass
- ✅ No regressions in existing tests
- ✅ Better test coverage for multi-slice containers
- ✅ More accurate validation against samtools

---

## Date

2025-11-19
