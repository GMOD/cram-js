# CRAM-JS Performance Benchmarking Guide

## Quick Start

To compare the current branch against master:

```bash
./compare-branches.sh
```

This script will:

1. Run profiling on your current branch (10 iterations)
2. Switch to master branch
3. Run profiling on master (10 iterations)
4. Switch back to your branch
5. Generate a comparison report

**Duration:** ~2-4 minutes depending on your system

---

## What Gets Generated

After running the comparison script, you'll have:

- **SRR396637-parsing-current.cpuprofile** - CPU profile from current branch
- **SRR396637-parsing-master.cpuprofile** - CPU profile from master branch
- **profile-current.txt** - Analysis of current branch (top 30 hotspots)
- **profile-master.txt** - Analysis of master branch (top 30 hotspots)
- **Comparison summary** - Printed to console showing speedup/regression

---

## Manual Profiling

If you want to run profiling manually without comparing to master:

```bash
# Run profiling (10 iterations)
yarn test profile

# Analyze the results
node analyze-profile-generic.mjs SRR396637-parsing.cpuprofile
```

---

## Analyzing Different Workloads

### Short Reads (Illumina-like)

```bash
# Already configured - uses test/data/SRR396637.sorted.clip.cram
yarn test profile
```

### Long Reads (ONT/PacBio)

Edit `benchmarks/profile.test.ts` and change the test file:

```typescript
cramFilehandle: testDataFile('HG002_ONTrel2_16x_RG_HP10xtrioRTG.chr1.cram'),
index: new CraiIndex({
  filehandle: testDataFile('HG002_ONTrel2_16x_RG_HP10xtrioRTG.chr1.cram.crai'),
}),
```

---

## Understanding the Results

### Profile Output Format

```
Top 30 functions by self time (microseconds) in cram-js code:

Self Time (μs) | Hit Count | Function Name | File
----------------------------------------------------------------------------------------------------
        240509 |       227 | getCompressionHeaderBlock | container/index.ts
        193919 |       181 | decodeDataSeries          | slice/index.ts
```

- **Self Time**: Time spent in this function (excluding called functions)
- **Hit Count**: Number of samples where this function was executing
- **Higher values = more time spent = optimization target**

### Comparison Output

```
RESULT:
  Time difference: -256ms (-17.1%)
  ✓ IMPROVEMENT: 1.21x faster
  Time saved: 256ms per run
```

- **Negative % = faster** (good!)
- **Positive % = slower** (regression)
- **Speedup > 1.0x = improvement**

---

## Current Branch Status

### Branch: init2

**Commits on this branch:**

- `5f68457` - Wow
- `0046a26` - Init2
- `893979e` - Optimize (contains the performance improvements)

**Base:** master branch (ef3a275 Update deps)

### Performance Results

**Verified improvement: 18.1% faster (1.22x speedup)**

- Master baseline: 14.39s
- Current branch: 11.79s
- Time saved: 2,600ms per run

### Changes Made

**Code optimizations (successfully merged):**

1. **Inlined external codec** - `src/cramFile/codecs/external.ts`
   - Removed function pointer indirection in decode path
   - decode (external): 1,347ms → 90ms (93% faster!)
   - \_decodeByte: 239ms → inlined
   - \_decodeInt: 140ms → inlined

2. **ByteBuffer post-increment** - `src/rans/index.ts`
   - Changed `this._buffer[this._position]; this._position += 1` to
     `this._buffer[this._position++]`
   - Applies to get(), getByte(), and put() methods

3. **Property caching in RANS** - `src/rans/d04.ts`, `src/rans/d14.ts`
   - Cache array references in tight loops (D.R, syms[l0], etc.)
   - Reduce repeated property lookups

**Failed attempts (reverted in Init2 commit):**

- Object pooling (caused regression when tested standalone)
- Manual Array.fill replacement (caused 63% regression)
- Lazy FC initialization (caused 1,750% regression!)

---

## Interpreting Hotspots

### Short Reads (Illumina)

Typical hotspots:

- `getCompressionHeaderBlock` - Parsing compression headers
- `decodeDataSeries` - Decoding data series
- `decode` (various codecs) - Data decoding
- RANS decompression - Order-0 and Order-1

### Long Reads (ONT/PacBio)

Typical hotspots:

- `readBlock` - I/O operations (dominant!)
- `DecodingSymbol`, `AriDecoder` - Object allocations
- `uncompressOrder0Way4` - Order-0 RANS (more than Order-1)
- `parser` - Encoding parsing

**Different workloads have different bottlenecks!**

---

## Tips for Optimization

### DO:

✅ Profile before and after every change ✅ Test incrementally (one change at a
time) ✅ Use native methods (Array.fill, etc.) ✅ Cache property lookups in
tight loops ✅ Keep object shapes consistent ✅ Test on both short and long read
workloads

### DON'T:

❌ Add method calls in hot loops ❌ Replace native methods with manual loops ❌
Mix object creation patterns ❌ Assume optimizations will work without profiling
❌ Make multiple changes at once

---

## Troubleshooting

### "Profile not generated"

- Check that the test completed successfully
- Look for errors in `yarn test profile` output
- Ensure test data files exist in `test/data/`

### "Uncommitted changes" warning

The script will warn you if you have uncommitted changes. You can:

1. Commit your changes first (recommended)
2. Stash your changes (`git stash`)
3. Continue anyway (type 'y' when prompted)

### Very different sample counts between runs

- Ensure both runs used the same number of iterations
- Check that you're comparing the same test file
- Verify no other processes were competing for CPU

### Profile looks completely different

- Check which test file is being used
- Verify the iteration count in `benchmarks/profile.test.ts`
- Make sure you're comparing apples to apples

---

## For More Information

- **OPTIMIZATION_ANALYSIS.md** - Detailed analysis of optimization opportunities
- **FAILED_OPTIMIZATIONS.md** - What didn't work and why
- **HG002_ANALYSIS.md** - Long reads specific analysis
- **NEXT_OPTIMIZATIONS.md** - Future optimization ideas
