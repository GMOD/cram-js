# Failed Optimizations - Lessons Learned

## Summary of Failed Attempts

This document tracks optimization attempts that caused regressions, to avoid
repeating mistakes.

---

## 1. Object Pooling for RANS Decoders (First Attempt)

**Date:** Initial optimization round **Target:** Reduce object allocations
**Result:** ❌ **59% SLOWER**

### What We Tried

Created a pool to reuse `AriDecoder` and `DecodingSymbol` objects across
decompression calls.

### Why It Failed

- Still allocated new `syms` arrays on every call
- Pooling overhead (pop/push, null checks) exceeded benefits
- GC pressure from partial pooling
- Wrong bottleneck for short reads

### Lesson

Object pooling adds overhead. Only pool when allocations are proven bottleneck
AND you pool everything expensive.

---

## 2. Replacing Array.fill() with Explicit Loops

**Date:** Initial optimization round **Target:** Optimize frequency table
building **Result:** ❌ **63% SLOWER**

### What We Tried

```typescript
// Replaced this:
decoder.R.fill(j, x, x + decoder.fc[j].F)

// With this:
const R = decoder.R
const end = x + decoder.fc[j].F
for (let k = x; k < end; k++) {
  R[k] = j
}
```

### Why It Failed

`Array.fill()` is a highly optimized native method. Manual JS loops are much
slower for filling arrays, especially for medium-sized ranges (typical RANS
frequency ranges are 10-100 elements).

### Lesson

Don't try to outsmart native array methods with manual loops. They're already
optimized.

---

## 3. Lazy FC Initialization

**Date:** Latest attempt **Target:** Reduce object creation in `AriDecoder`
constructor **Result:** ❌ **17.5x SLOWER** (!!!)

### What We Tried

```typescript
// Before: Eagerly create 256 FC objects
constructor() {
  this.fc = new Array(256)
  for (let i = 0; i < this.fc.length; i += 1) {
    this.fc[i] = new FC()
  }
  this.R = null
}

// After: Create FC objects lazily
constructor() {
  this.fc = new Array(256)  // Array of undefined
  this.R = null
}

getFC(index) {
  let fc = this.fc[index]
  if (!fc) {
    fc = this.fc[index] = { F: undefined, C: undefined }
  }
  return fc
}
```

### Why It Failed

**Catastrophic performance impact:**

- Total time: 1.2s → 21.8s (17.5x slower!)
- `parser` function: 46ms → 7,000ms (150x slower!)

**Root causes (hypotheses):**

1. **Function call overhead:** Adding `getFC()` method call in hot loop
2. **Megamorphic property access:** Plain objects `{ F, C }` vs class instances
   confused optimizer
3. **Hidden class transitions:** Dynamic object creation caused V8
   deoptimization
4. **Cache misses:** Null checks and branches disrupted CPU pipeline

The regression was so severe it affected unrelated code paths (parser went from
3.9% to 32% of time!), suggesting broad V8 deoptimization.

### Detailed Analysis

**Profile comparison:**

| Metric          | Before      | After         | Change     |
| --------------- | ----------- | ------------- | ---------- |
| Total time      | 1,244ms     | 21,849ms      | **+17.5x** |
| Samples         | 1,177       | 19,485        | +16.5x     |
| parser          | 46ms (3.9%) | 7,004ms (32%) | **+150x**  |
| cramEncodingSub | 168ms       | 1,614ms       | +9.6x      |

**Why parser got 150x slower:**

Parser code calls encoding parsing, which may trigger RANS initialization. The
lazy initialization likely:

- Caused V8 to deoptimize surrounding code
- Introduced branch mispredictions
- Broke inline caching
- Forced megamorphic property access patterns

### Lesson

**Critical lessons from this failure:**

1. **Method calls in hot loops are expensive** - Even a simple getter can
   destroy performance
2. **Object shape consistency matters** - Mixing plain objects and class
   instances confuses optimizer
3. **V8 optimizations are fragile** - Small changes can cause cascading
   deoptimization
4. **Always profile!** - This seemed like a safe optimization but caused
   catastrophic regression
5. **Eager initialization has benefits** - V8 can better optimize when object
   shapes are known upfront

### Why Eager Initialization Performs Better

```typescript
// Eager (fast):
for (let i = 0; i < 256; i++) {
  this.fc[i] = new FC() // Same hidden class, predictable
}

// Later access:
const fc = this.fc[j] // Monomorphic, inlineable
fc.F = value // Known shape, fast property access
```

vs

```typescript
// Lazy (slow):
getFC(index) {
  let fc = this.fc[index]  // Maybe undefined, maybe object
  if (!fc) {               // Branch!
    fc = this.fc[index] = { F: undefined, C: undefined }  // Different shape
  }
  return fc              // Polymorphic return type
}

// Later access:
const fc = this.getFC(j)  // Function call overhead
fc.F = value              // Megamorphic property access
```

The eager approach:

- **Predictable shapes:** V8 knows all fc[i] are FC instances
- **No branches:** Direct array access
- **Inline cacheable:** Monomorphic property access
- **Better speculation:** CPU can predict access patterns

The lazy approach:

- **Function call overhead:** Cannot be inlined effectively
- **Branches:** If statement disrupts pipeline
- **Multiple shapes:** undefined vs object confuses optimizer
- **Megamorphic:** V8 can't inline property access

---

## Successful Optimizations (For Reference)

### ✅ ByteBuffer Post-Increment

```typescript
// Before:
get() {
  const b = this._buffer[this._position]
  this._position += 1
  return b
}

// After:
get() {
  return this._buffer[this._position++]
}
```

**Result:** Part of 17% improvement

### ✅ Inline External Codec Methods

Removed function pointer indirection in decode path **Result:** Part of 17%
improvement

### ✅ Cache Property Lookups in Tight Loops

```typescript
const D_R = D.R // Cache array reference
const sym = syms[l0][c0] // Cache symbol
```

**Result:** Part of 17% improvement

---

## General Optimization Principles (Updated)

### DO:

- ✅ Profile before and after EVERY change
- ✅ Test incrementally (one optimization at a time)
- ✅ Eliminate unnecessary work (function calls, branches)
- ✅ Use native methods (Array.fill, etc.)
- ✅ Cache property lookups in tight loops
- ✅ Keep object shapes consistent
- ✅ Prefer eager initialization for hot paths
- ✅ Trust V8's optimizations for common patterns

### DON'T:

- ❌ Add method calls in hot loops (even getters)
- ❌ Replace native methods with manual loops
- ❌ Mix object creation patterns (classes vs plain objects)
- ❌ Add branches in tight loops without profiling
- ❌ Pool objects without measuring allocation overhead
- ❌ Assume lazy initialization is always better
- ❌ Optimize without profiling

---

## Debugging Performance Regressions

When you see unexpected slowdown:

1. **Compare profiles side-by-side**
   - Look at total time AND distribution
   - Check if new hotspots appeared
   - Look for functions getting unexpectedly slower

2. **Check for deoptimization**
   - Run with `--trace-deopt` flag
   - Look for "Bailout" messages
   - Check inline cache status

3. **Verify object shapes**
   - Use `--trace-ic` to see inline cache behavior
   - Check for megamorphic property access
   - Ensure consistent object shapes

4. **Measure allocation rate**
   - Use `--trace-gc` to see GC pressure
   - Check if optimization increased allocations

5. **Always have a rollback plan**
   - Commit working code before optimizing
   - Test immediately after each change
   - Revert quickly if regression is severe

---

## Current Status

**Working optimizations:** 17.1% improvement on short reads

- ByteBuffer post-increment
- Inlined codec methods
- Cached property lookups in RANS loops

**Safe next steps:**

- Batch block reading (doesn't touch hot loops)
- Parser caching (memoization, not structural changes)
- Order-0 specific tuning (apply existing patterns)

**Avoid:**

- Any changes to object creation patterns in RANS
- Lazy initialization in hot paths
- Adding method calls in tight loops
