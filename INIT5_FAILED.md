# Init5 - Failed Optimization

## What We Tried

Two optimizations were attempted in init5:

### 1. Cache External Block Lookups in ExternalCodec (FAILED)
**Status**: ❌ **Reverted** - Broke 13 snapshot tests

**Issue**: Codecs are reused across different slices via instantiateCodec memoization, but caching blocks/cursors is slice-specific. This caused codecs to read from wrong blocks when processing multiple slices.

### 2. Memoize instantiateCodec with WeakMap (MIXED RESULTS)
**Status**: ⚠️ **Reverted** - Hurt short reads, helped long reads

**Results**:
- Short reads: +4.4% regression (7.5s → 7.9s)
- Long reads: -2.4% improvement (3.9s → 3.8s)

**Why it failed**: WeakMap lookup overhead exceeds the savings for short reads. Short reads don't create many codec instances, so memoization adds overhead without benefit.

---

## Lessons Learned

1. **State caching requires careful lifecycle management**: Can't cache slice-specific data at codec level when codecs are reused
2. **Memoization has overhead**: WeakMap lookups aren't free - only beneficial when there's significant reuse
3. **Different workloads need different optimizations**: What helps long reads can hurt short reads
4. **Always test both workloads**: Optimization may help one but hurt the other

---

## Why External Block Caching Failed

```typescript
// The problem:
class ExternalCodec {
  private _cachedBlock?: CramFileBlock  // ← Cached for slice 1

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    if (!this._cachedBlock) {
      this._cachedBlock = blocksByContentId[blockContentId]  // Slice 1's block
      this._cachedCursor = cursors.externalBlocks.getCursor(blockContentId)
    }
    // Later, when processing slice 2, still uses slice 1's cached block!
    const contentBlock = this._cachedBlock  // ← Wrong data!
  }
}
```

**Root cause**: Codec instances are shared via `instantiateCodec` memoization, so the same codec is used for multiple slices.

**Fix would require**: Making cache slice-aware or not reusing codec instances

---

## Why Codec Memoization Had Mixed Results

**For Long Reads**:
- More diverse encodings → more codec creation
- Memoization avoids repeated codec construction
- Savings > WeakMap lookup overhead
- **Result**: 2.4% improvement

**For Short Reads**:
- Fewer unique encodings
- Less codec reuse
- WeakMap lookup overhead > savings
- **Result**: 4.4% regression

---

## Alternative Approaches

### For External Block Lookups

Instead of caching at codec level, could:
1. **Pass cached lookups as parameters** - caller caches, not codec
2. **Use a per-slice cache** - invalidate when slice changes
3. **Optimize getCursor()** - make the lookup itself faster

### For Codec Creation

Instead of WeakMap memoization, could:
1. **Only memoize for specific codec types** (e.g., only ByteArrayLength which is expensive)
2. **Use a simpler cache** with size limit instead of WeakMap
3. **Profile to see if codec creation is actually a bottleneck** (it's 98ms out of 3.9s = 2.5%)

---

## Next Steps

Since init5 optimizations didn't work out, should try:

1. **Investigate _parseSection** (750ms in long reads) - bigger target
2. **Optimize parseItf8** - appears frequently in both workloads
3. **Look at getRecords** (305ms in short reads)
4. **Consider different approach to external codec optimization**

---

## Files

- init5 branch exists but reverted
- No profile files saved (optimization was reverted)
- Tests all pass after revert
