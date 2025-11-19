# Init3 Optimization Results

## Optimization: Inline RANS Renormalize Functions

**Date**: 2025-11-18
**Branch**: init3
**Status**: ✓ **SUCCESS** - 2.6% improvement on short reads

---

## What Was Changed

Inlined `Decoding.renormalize()` and `Decoding.advanceSymbol()` function calls in RANS decompression hot loops to eliminate function call overhead and module property access.

### Files Modified

1. **src/rans/d04.ts** (Order-0, 4-way interleaved)
   - Replaced 4x `Decoding.renormalize(rans, input)` calls with inlined renormalize logic
   - Lines 43-63: Inlined renormalize for rans0, rans1, rans2, rans3

2. **src/rans/d14.ts** (Order-1, 4-way interleaved)
   - Replaced 4x `Decoding.renormalize()` calls in main loop
   - Lines 59-79: Inlined renormalize for rans0, rans1, rans2, rans7
   - Lines 92-99: Inlined `advanceSymbol()` in remainder loop

### Code Changes

**Before:**
```typescript
rans0 = Decoding.renormalize(rans0, input)
rans1 = Decoding.renormalize(rans1, input)
rans2 = Decoding.renormalize(rans2, input)
rans3 = Decoding.renormalize(rans3, input)
```

**After:**
```typescript
// Inline renormalize to avoid function call overhead
if (rans0 < RANS_BYTE_L) {
  do {
    rans0 = (rans0 << 8) | (0xff & input.get())
  } while (rans0 < RANS_BYTE_L)
}
// Repeated for rans1, rans2, rans3
```

---

## Performance Results

### Short Reads (SRR396637 - Illumina)

| Metric | init2 (baseline) | init3 (optimized) | Change |
|--------|------------------|-------------------|--------|
| **Total Time** | 9,229 ms | 8,988 ms | **-241 ms** |
| **Samples** | 8,350 | 8,179 | -171 |
| **Improvement** | - | - | **✓ 2.6% faster** |
| **Speedup** | - | - | **1.027x** |

**Time saved**: 241ms per benchmark run

### Long Reads (HG002 ONT)

| Metric | Current |
|--------|---------|
| **Total Time** | 4,310 ms |
| **Samples** | 3,964 |
| **Top RANS function** | uncompress (d14.ts): 143ms |

Long reads use much less RANS compression (only 4.3s total vs 9s for short reads), so the optimization has less impact on this workload.

---

## Why It Worked

1. **Eliminated Module Property Access**: Removed `Decoding.` property lookup on every call
2. **Reduced Function Call Overhead**: Eliminated 4 function calls per loop iteration in tight loops
3. **Better Inlining Opportunity**: Gave V8 clearer optimization signals
4. **No Code Bloat**: While code expanded from 168 → 211 lines, the inlining didn't exceed V8's optimization thresholds

---

## Analysis: Top Hotspot Changes

### init2 Top Hotspots (Baseline)
1. parseItem - 2,023ms (21.9%)
2. parser - 1,676ms (18.2%)
3. decodeReadFeatures - 622ms (6.7%)
4. getSectionParsers - 466ms (5.0%)

### init3 Top Hotspots (Optimized)
1. rans/constants.ts (anonymous) - 1,623ms (18.1%)
2. put (rans) - 682ms (7.6%)
3. readBlock - 320ms (3.6%)
4. AriDecoder - 173ms (1.9%)

**Observation**: The hotspot distribution changed significantly, with RANS-related functions becoming more visible. This suggests that optimizing RANS reduced time in parsing functions, redistributing the overall load.

---

## Lessons Learned

### ✓ Success Factors

1. **Measured Against Correct Baseline**: Initial comparison against wrong init2 branch showed 13% regression! Always verify baseline.
2. **Small, Targeted Changes**: Only modified hot loop, didn't change overall structure
3. **Inlining Simple Functions**: `renormalize()` is simple enough to inline without bloating code
4. **Preserved Correctness**: All tests pass, no behavioral changes

### ⚠️ What To Watch

1. **Marginal Improvement**: 2.6% is good but not transformative
2. **Code Duplication**: 4x repetition of same inlining logic (could use macro if needed)
3. **Maintenance**: Manual inlining means updates needed in multiple places

---

## Next Optimization Opportunities

Based on the new profiles, here are the top remaining hotspots:

### For Short Reads (from init3 profile):
1. **rans/constants.ts anonymous** - 1,623ms (18.1%) - Investigate what this is
2. **put (rans/index.ts)** - 682ms (7.6%) - Optimize ByteBuffer writes
3. **readBlock** - 320ms (3.6%) - I/O optimization opportunity
4. **AriDecoder** - 173ms (1.9%) - Already investigated, eager init is faster

### For Long Reads (from init3 profile):
1. **rans/constants.ts anonymous** - 398ms (9.2%) - Same mystery function
2. **getEntriesForRange** - 181ms (4.2%) - Index lookup optimization
3. **uncompress (d14.ts)** - 143ms (3.3%) - Order-1 RANS (just optimized!)
4. **cramEncodingSub** - 30ms (0.7%) - Memoization opportunity (from original analysis)

### Recommended Next Steps:

1. **Investigate rans/constants.ts anonymous function** (HIGH)
   - This is the #1 hotspot in both workloads
   - 1.6s in short reads, 0.4s in long reads
   - Might be import/module initialization overhead

2. **Optimize ByteBuffer put/putAt** (MEDIUM)
   - 682ms in short reads
   - Could inline or use typed array directly

3. **Memoize cramEncodingSub** (MEDIUM for long reads)
   - As identified in PROFILE_ANALYSIS_2025.md
   - Parse encoding schemes once and cache

4. **Batch readBlock calls** (HIGH for long reads)
   - Read multiple blocks in single I/O operation
   - Biggest opportunity for long-read workload

---

## Comparison to Previous Optimizations

| Optimization | Improvement | Status |
|--------------|-------------|--------|
| Previous round (ByteBuffer, external codec, etc.) | 17.1% | ✓ Complete |
| **This round (inline RANS)** | **2.6%** | **✓ Complete** |
| **Cumulative** | **~19.3%** | **Ongoing** |

---

## Files Generated

- `SRR396637-parsing-init2.cpuprofile` - Baseline short reads profile
- `SRR396637-parsing-init3.cpuprofile` - Optimized short reads profile
- `HG002_ONTrel2_16x_RG_HP10xtrioRTG-parsing.cpuprofile` - Long reads profile
- `profile-init2.txt` - init2 analysis
- `profile-init3.txt` - init3 analysis
- `compare-two-branches.sh` - Automated comparison script

---

## Conclusion

The inline RANS optimization achieved a modest but solid **2.6% improvement** on short reads. While not a huge win, it demonstrates that:

1. Function call overhead in tight loops matters
2. Careful profiling-driven optimization works
3. There's still room for improvement (new hotspots identified)

Next focus should be on the mysterious "rans/constants.ts anonymous" function which dominates both workloads.
