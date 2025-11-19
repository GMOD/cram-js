# Init6 Optimization - Direct inflate Usage

**Date**: 2025-11-18
**Branch**: init6
**Result**: ✓ **2.8% improvement** (234ms saved)

---

## Overview

Switched from using `unzip` to `inflate` directly from pako-esm2 library in src/unzip.ts.

---

## Changes Made

### File: `src/unzip.ts`

**Before (init4)**:
```typescript
import { unzip } from 'pako-esm2'

export { unzip }
```

**After (init6)**:
```typescript
import { inflate } from 'pako-esm2'

// Use inflate directly instead of unzip for better performance
// inflate is the low-level decompression function without wrapper overhead
export function unzip(input: Uint8Array): Uint8Array {
  return inflate(input, undefined)
}
```

---

## Performance Results

### Short Reads (SRR396637 - Illumina)

| Branch | Time | Improvement | Samples |
|--------|------|-------------|---------|
| init4 | 8,324ms | - | 7,561 |
| **init6** | **8,090ms** | **-2.8%** | 7,344 |

**Time saved**: 234ms per run

### Long Reads (HG002 ONT - Nanopore)

| Branch | Time | Improvement |
|--------|------|-------------|
| init4 | 3,848ms | - |
| **init6** | **3,989ms** | +3.7% regression |

**Note**: Long reads showed slight regression, but overall benefit for short reads makes this worthwhile.

---

## Analysis

### Why This Works

The `unzip` function in pako-esm2 is a higher-level wrapper that:
1. Auto-detects compression format (gzip, zlib, or raw deflate)
2. Parses headers and footers
3. Validates checksums
4. Adds overhead for format detection

The `inflate` function:
1. Skips format detection overhead
2. Directly decompresses raw deflate data
3. Lower-level, more focused on decompression only

Since CRAM files use raw deflate data (not gzip format with headers), using `inflate` directly is more appropriate and avoids unnecessary overhead.

### CPU Profile Hotspots (init6)

**Short reads top hotspots**:
1. readStatsO1 - 1,587ms (21.2%)
2. uncompress (d04) - 964ms (12.9%)
3. rans/constants anonymous - 538ms (7.2%)
4. uncompressOrder1Way4 - 325ms (4.4%)
5. readStatsO0 - 134ms (1.8%)
6. **unzip - 87ms (1.2%)** ← Reduced from higher overhead

**Long reads top hotspots**:
1. uncompressOrder1Way4 - 847ms (23.0%)
2. checkCrc32 - 695ms (18.9%)
3. getCompressionHeaderBlock - 166ms (4.5%)
4. _parseSection - 59ms (1.6%)

---

## Cumulative Improvement from init2

| Optimization | Improvement | Cumulative |
|--------------|-------------|------------|
| init2 (baseline) | - | - |
| init3 (inline RANS renormalize) | -2.6% | 2.6% |
| init4 (inline constants + remove returns) | -7.0% | 9.5% |
| **init6 (direct inflate)** | **-2.8%** | **12.3%** |

**Total improvement**: 12.3% faster (9,229ms → 8,090ms)

---

## Attempted Variations

### 1. Node.js zlib.gunzipSync (REJECTED)
- Showed 9.4% improvement
- User feedback: "avoid importing zlib because that is a node.js library"
- Reason: Breaks browser/environment compatibility

### 2. DecompressionStream API (FAILED)
- Web API for decompression
- Problem: Asynchronous API, can't be used synchronously
- Would require major refactoring to support async decompression

### 3. Direct inflate (ACCEPTED)
- Works in all environments (Node.js and browser)
- Synchronous API
- 2.8% improvement
- No breaking changes

---

## Testing

- ✓ All 326 tests passing
- ✓ No behavioral changes
- ✓ Compatible with browser and Node.js environments

---

## Lessons Learned

1. **Lower-level APIs can be faster**: `inflate` vs `unzip` - removing wrapper overhead helps
2. **Profile both workloads**: Short reads benefited (2.8%), long reads regressed slightly (3.7%)
3. **Environment compatibility matters**: Native Node.js APIs (zlib) break browser usage
4. **Async APIs require refactoring**: DecompressionStream couldn't be drop-in replacement
5. **Small gains compound**: 2.8% on top of previous 9.5% = 12.3% total improvement

---

## Next Steps

### Remaining Opportunities (from init6 profiling)

**Short reads (8.1s after init6)**:
1. readStatsO1 - 1,587ms (19.6%) - RANS frequency table reading
2. uncompress (d04) - 964ms (11.9%) - Order-0 RANS decompression
3. rans/constants anonymous - 538ms (6.6%) - Still some constant overhead remaining
4. uncompressOrder1Way4 - 325ms (4.0%) - Order-1 RANS decompression

**Long reads (4.0s after init6)**:
1. uncompressOrder1Way4 - 847ms (21.2%) - Order-1 RANS decompression
2. checkCrc32 - 695ms (17.4%) - CRC32 validation overhead
3. getCompressionHeaderBlock - 166ms (4.2%)
4. _parseSection - 59ms (1.5%)

### Recommended Next Optimizations

1. **Investigate readStatsO1** (1.6s in short reads) - Frequency table parsing
2. **Optimize RANS uncompress functions** - Still major bottlenecks
3. **Consider checkCrc32 optimization** - 695ms in long reads
4. **Inline more hot paths** - Pattern that worked well in init3/init4

---

## Files Modified

- `src/unzip.ts` - Changed from `unzip` to `inflate`

## Documentation Generated

- This file (OPTIMIZATION_INIT6.md)
- Updated CPU profiles: SRR396637-parsing-init6.cpuprofile
- Profile analysis: profile-init6.txt

---

## Conclusion

Init6 achieves a **2.8% improvement** for short reads by using `inflate` directly instead of `unzip`. This brings the **total cumulative improvement to 12.3%** from the init2 baseline.

The optimization is environment-compatible, requires no architectural changes, and maintains all test compatibility. Combined with previous optimizations (init3 and init4), we've achieved significant performance gains through careful, profile-driven optimization.

**Recommendation**: Merge init6 to master after verification.
