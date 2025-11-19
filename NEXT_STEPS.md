# Next Optimization Steps

## Current Status

✓ **init3 Complete**: Inline RANS renormalize - **2.6% improvement** on short reads
✓ **Cumulative improvement**: ~19.3% since original baseline
✓ **Tests passing**: All correctness tests pass

---

## Top Remaining Hotspots (init3 Profile)

### Short Reads (SRR396637)
| Rank | Function | Time | % | Opportunity |
|------|----------|------|---|-------------|
| 1 | (anonymous) in rans/constants.ts | 1,623ms | 18.1% | Profiler artifact - investigate |
| 2 | put (ByteBuffer) | 682ms | 7.6% | ✓ **HIGH** - Optimize writes |
| 3 | readBlock | 320ms | 3.6% | ✓ **MEDIUM** - Batch I/O |
| 4 | AriDecoder constructor | 173ms | 1.9% | Already optimized |
| 5 | parser | 90ms | 1.0% | Investigate |

### Long Reads (HG002 ONT)
| Rank | Function | Time | % | Opportunity |
|------|----------|------|---|-------------|
| 1 | (anonymous) in rans/constants.ts | 398ms | 9.2% | Profiler artifact |
| 2 | getEntriesForRange | 181ms | 4.2% | ✓ **MEDIUM** - Index optimization |
| 3 | uncompress (d14.ts) | 143ms | 3.3% | Just optimized! |
| 4 | cramEncodingSub | 30ms | 0.7% | ✓ **LOW** - Memoization |
| 5 | instantiateCodec | (not in top) | - | ✓ **LOW** - Memoization |

---

## Recommended Next Optimizations (Priority Order)

### 1. Optimize ByteBuffer put/putAt (SHORT READS - 682ms)

**Impact**: HIGH - 7.6% of total time in short reads
**Risk**: LOW - straightforward optimization
**Effort**: SMALL

**Current issue**: ByteBuffer wrapper adds overhead on every write

**Location**: `src/rans/index.ts` - ByteBuffer class

**Current**:
```typescript
put(value) {
  this._buffer[this._position] = value
  this._position += 1
}

putAt(index, value) {
  this._buffer[index] = value
}
```

**Optimization**: Use post-increment directly
```typescript
put(value) {
  this._buffer[this._position++] = value
}

// putAt is already optimal - direct array access
```

**Alternative**: Skip ByteBuffer entirely and use Uint8Array directly in RANS decompression loops.

**Expected improvement**: 3-5% on short reads

---

### 2. Investigate "rans/constants.ts anonymous" (BOTH - 1.6s + 0.4s)

**Impact**: HIGH - Largest hotspot if real
**Risk**: MEDIUM - may be profiler artifact
**Effort**: SMALL (investigation) to MEDIUM (if real issue found)

**Hypothesis**: This is likely V8 attributing time spent in code that *uses* the constants back to the module.

**Actions**:
1. Check if this is real by running with `--prof` and analyzing V8 tick data
2. Try inlining constants as literals in hot paths
3. Compute `mask = (1 << TF_SHIFT) - 1` once instead of in every function

**Code change to test**:
```typescript
// Instead of importing TF_SHIFT and computing mask
// In d04.ts and d14.ts:
const TF_SHIFT = 12
const mask = 4095  // (1 << 12) - 1
const RANS_BYTE_L = 8388608  // 1 << 23
```

**Expected improvement**: Unknown - may be 0% if profiler artifact, or 5-10% if real

---

### 3. Memoize cramEncodingSub (LONG READS - 30ms potential, more in full workload)

**Impact**: MEDIUM for long reads (low in profile but high in original analysis)
**Risk**: MEDIUM - caching requires correct cache key
**Effort**: MEDIUM

**Implementation**: See PROFILE_ANALYSIS_2025.md #2 for full details

**Expected improvement**: 5-10% on long reads with high encoding diversity

---

### 4. Batch readBlock I/O (LONG READS - 320ms+ potential)

**Impact**: HIGH for long reads (was 25% in original analysis)
**Risk**: HIGH - Complex change to I/O layer
**Effort**: LARGE

**See**: NEXT_OPTIMIZATIONS.md for detailed implementation plan

**Expected improvement**: 10-15% on long reads

---

## Testing Strategy

For each optimization:

1. Create new branch (init4, init5, etc.)
2. Implement optimization in isolation
3. Run comparison: `./compare-two-branches.sh init3 init4`
4. Verify improvement > 2%
5. Run full test suite: `yarn test`
6. If successful: commit, merge, move to next
7. If regression: revert, document in FAILED_OPTIMIZATIONS.md

---

## Quick Wins to Try First

1. **ByteBuffer.put() post-increment** - 10 minutes, 3-5% expected
2. **Inline constants as literals** - 15 minutes, 0-5% expected (may be zero)
3. **Compute mask once** - 5 minutes, 1-2% expected

**Total time**: ~30 minutes
**Potential gain**: 4-12%

---

## Long-term Opportunities

After quick wins, consider:

1. **WebAssembly RANS decoder** - 20-40% for RANS-heavy workloads (LARGE effort)
2. **Worker thread parallelism** - 30-50% for multi-container files (LARGE effort)
3. **Streaming API** - Better memory efficiency (LARGE effort)
4. **Memoization layer** - 5-15% for parsing-heavy workloads (MEDIUM effort)

---

## Success Metrics

**Target for init4**: Additional 5-10% improvement
**Overall target**: 25-30% cumulative improvement from original baseline

**Current**: 19.3% cumulative
**Remaining to target**: 5.7-10.7%

---

## Notes

- Profile shows different hotspots in short vs long reads
- Optimizations should be tested on BOTH workloads
- Some optimizations may help one workload but not the other
- Always measure before/after - don't trust intuition!
