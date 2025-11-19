# CRAM-JS Profile Analysis - New Optimization Opportunities

## Executive Summary

Analysis of short-read (SRR396637) and long-read (HG002 ONT) workloads reveals **completely different performance characteristics**, requiring targeted optimizations for each:

- **Short reads (9.9s)**: 28% in RANS decompression, dominated by module property access overhead
- **Long reads (5.1s)**: 71% in codec/encoding parsing, dominated by repeated parsing without caching

## Profile Comparison

### Short Reads (Illumina) - 9.9s total

| Function | Self Time | % Total | Location |
|----------|-----------|---------|----------|
| (anonymous) | 1.92s | 19.4% | rans/constants.ts |
| (anonymous) | 0.91s | 9.2% | rans/decoding.ts |
| read | 0.08s | 0.8% | cramFile/file.ts |
| _uncompressPre | 0.07s | 0.7% | cramFile/file.ts |
| parser | 0.06s | 0.6% | cramFile/sectionParsers.ts |

**Key insight**: RANS decompression (2.8s, 28%) dominates, but most time is in "anonymous" functions - likely module property access overhead.

### Long Reads (Nanopore) - 5.1s total

| Function | Self Time | % Total | Location |
|----------|-----------|---------|----------|
| cramEncodingSub | 1.34s | 26.5% | cramFile/sectionParsers.ts |
| decode (external) | 0.82s | 16.2% | cramFile/codecs/external.ts |
| parser | 0.55s | 10.9% | cramFile/sectionParsers.ts |
| (anonymous) | 0.38s | 7.4% | cramFile/util.ts |
| _getLengthCodec | 0.36s | 7.2% | cramFile/codecs/byteArrayLength.ts |
| instantiateCodec | 0.31s | 6.1% | cramFile/codecs/index.ts |
| decodeDataSeries | 0.29s | 5.7% | cramFile/slice/index.ts |

**Key insight**: Codec/encoding handling (3.6s, 71%) dominates. RANS is barely visible (0.03s, 0.6%), suggesting long reads use different compression schemes.

---

## High-Priority Optimizations

### 1. Inline Decoding Functions in RANS (SHORT READS - 2.8s potential)

**Problem**: Lines like `Decoding.renormalize()`, `Decoding.get()` add property lookup overhead in tight loops.

**Location**: src/rans/d04.ts:43-46, similar patterns in d14.ts

**Current code**:
```typescript
rans0 = Decoding.renormalize(rans0, input)
rans1 = Decoding.renormalize(rans1, input)
rans2 = Decoding.renormalize(rans2, input)
rans3 = Decoding.renormalize(rans3, input)
```

**Optimization**: Import functions directly and inline the renormalize logic:
```typescript
// At top of file
import { renormalize, RANS_BYTE_L } from './decoding.ts'

// In loop - inline renormalize
if (rans0 < RANS_BYTE_L) {
  do {
    rans0 = (rans0 << 8) | (0xff & input.get())
  } while (rans0 < RANS_BYTE_L)
}
// Same for rans1, rans2, rans3
```

**Expected Impact**: 5-10% on short reads (reducing 2.8s overhead)

**Risk**: LOW - straightforward inlining, already done partially in d04.ts line 38-41

---

### 2. Memoize cramEncodingSub (LONG READS - 1.34s potential)

**Problem**: `cramEncodingSub` parses encoding schemes from buffers repeatedly. The same encoding schemes are parsed many times.

**Location**: src/cramFile/sectionParsers.ts:431-546

**Current**: Function parses encoding scheme from buffer every time it's called:
```typescript
function cramEncodingSub(buffer: Uint8Array, offset: number) {
  const [codecId, newOffset1] = parseItf8(buffer, offset)
  // ... lots of parsing ...
  // Recursive calls for nested encodings
  const { value: lengthsEncoding } = cramEncodingSub(buffer, offset)
  const { value: valuesEncoding } = cramEncodingSub(buffer, offset)
}
```

**Optimization**: Create memoization wrapper based on buffer hash:
```typescript
const encodingCache = new Map<string, { value: Value; offset: number }>()

function cramEncodingSubCached(buffer: Uint8Array, offset: number) {
  // Create cache key from buffer slice (encoding data is typically small)
  const endOffset = Math.min(offset + 50, buffer.length)
  const slice = buffer.subarray(offset, endOffset)

  // Simple hash: first 16 bytes as key
  const keyBytes = slice.subarray(0, Math.min(16, slice.length))
  const key = Array.from(keyBytes).join(',')

  if (encodingCache.has(key)) {
    return encodingCache.get(key)!
  }

  const result = cramEncodingSub(buffer, offset)
  encodingCache.set(key, result)
  return result
}
```

**Expected Impact**: 15-25% on long reads (1.34s → ~0.3s)

**Risk**: MEDIUM - need to ensure cache key is reliable and cache doesn't grow unbounded. Add cache size limit (e.g., LRU with 1000 entries).

---

### 3. Memoize instantiateCodec (LONG READS - 0.31s potential)

**Problem**: Creates new codec instances repeatedly for the same encoding data.

**Location**: src/cramFile/codecs/index.ts:29-43

**Current**: Creates new codec instance every time:
```typescript
export function instantiateCodec(encodingData: CramEncoding, dataType: DataType) {
  const CodecClass = getCodecClassWithId(encodingData.codecId)
  return new CodecClass(encodingData.parameters, dataType, instantiateCodec)
}
```

**Optimization**: Add WeakMap-based memoization:
```typescript
const codecCache = new WeakMap<object, Map<string, CramCodec>>()

export function instantiateCodec(encodingData: CramEncoding, dataType: DataType) {
  // Use encodingData object as WeakMap key (automatically GC'd when encoding data is gone)
  let cache = codecCache.get(encodingData)
  if (!cache) {
    cache = new Map()
    codecCache.set(encodingData, cache)
  }

  const cacheKey = `${encodingData.codecId}_${dataType}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!
  }

  const CodecClass = getCodecClassWithId(encodingData.codecId)
  const codec = new CodecClass(encodingData.parameters, dataType, instantiateCodec)
  cache.set(cacheKey, codec)
  return codec
}
```

**Expected Impact**: 3-7% on long reads (0.31s → ~0.1s)

**Risk**: LOW - WeakMap prevents memory leaks, codecs are stateless for given encoding

---

### 4. Optimize _tinyMemoized Function (BOTH - 0.17s + overhead)

**Problem**: The memoization helper itself shows up in profiles (0.17s in long reads), suggesting overhead.

**Location**: src/cramFile/util.ts:182-196

**Current implementation**:
```typescript
export function tinyMemoize(_class: any, methodName: any) {
  const method = _class.prototype[methodName]
  const memoAttrName = `_memo_${methodName}`
  _class.prototype[methodName] = function _tinyMemoized() {
    let res = this[memoAttrName]  // Property lookup
    if (res === undefined) {      // Undefined check
      res = method.call(this)
      this[memoAttrName] = res
      Promise.resolve(res).catch(() => {  // Async overhead
        delete this[memoAttrName]
      })
    }
    return res
  }
}
```

**Issues**:
1. `res === undefined` check doesn't distinguish between "not memoized" and "memoized as undefined"
2. `Promise.resolve().catch()` adds async overhead on first call
3. String property lookup `this[memoAttrName]` not as fast as direct property

**Optimization**:
```typescript
const MEMO_SENTINEL = Symbol('not-memoized')

export function tinyMemoize(_class: any, methodName: any) {
  const method = _class.prototype[methodName]
  const memoAttrName = `_memo_${methodName}`

  _class.prototype[methodName] = function _tinyMemoized() {
    let res = this[memoAttrName]
    if (res === MEMO_SENTINEL || res === undefined) {
      res = method.call(this)
      this[memoAttrName] = res ?? MEMO_SENTINEL
      // Only handle promise rejections if result is actually a promise
      if (res && typeof res.catch === 'function') {
        res.catch(() => { this[memoAttrName] = MEMO_SENTINEL })
      }
    }
    return res === MEMO_SENTINEL ? undefined : res
  }
}
```

**Expected Impact**: 2-4% overall (reduces memoization overhead)

**Risk**: LOW - cleaner logic, handles edge cases better

---

### 5. Cache External Block Lookups (LONG READS - 0.82s potential)

**Problem**: `ExternalCodec.decode` does dictionary lookup and cursor lookup on every decode.

**Location**: src/cramFile/codecs/external.ts:25-54

**Current**:
```typescript
decode(slice, coreDataBlock, blocksByContentId, cursors) {
  const { blockContentId } = this.parameters
  const contentBlock = blocksByContentId[blockContentId]  // Lookup every time
  const cursor = cursors.externalBlocks.getCursor(blockContentId)  // Lookup every time

  if (this.dataType === 'int') {
    const [result, bytesRead] = parseItf8(contentBlock.content, cursor.bytePosition)
    cursor.bytePosition += bytesRead
    return result
  } else {
    return contentBlock.content[cursor.bytePosition++]!
  }
}
```

**Optimization**: Cache block and cursor references:
```typescript
constructor(parameters, dataType) {
  super(parameters, dataType)
  this._cachedBlock = null
  this._cachedCursor = null
}

decode(slice, coreDataBlock, blocksByContentId, cursors) {
  // Cache block and cursor on first access
  if (!this._cachedBlock) {
    const { blockContentId } = this.parameters
    this._cachedBlock = blocksByContentId[blockContentId]
    this._cachedCursor = cursors.externalBlocks.getCursor(blockContentId)
  }

  const contentBlock = this._cachedBlock
  const cursor = this._cachedCursor

  if (this.dataType === 'int') {
    const [result, bytesRead] = parseItf8(contentBlock.content, cursor.bytePosition)
    cursor.bytePosition += bytesRead
    return result
  } else {
    return contentBlock.content[cursor.bytePosition++]!
  }
}
```

**Expected Impact**: 8-12% on long reads (0.82s → ~0.5s)

**Risk**: MEDIUM - need to ensure cache invalidation strategy aligns with codec lifecycle

---

## Medium-Priority Optimizations

### 6. Optimize parseItf8 (BOTH - ~0.04s direct, more indirect)

**Location**: src/cramFile/util.ts (parseItf8 function)

**Opportunity**: parseItf8 is called frequently. Could optimize with:
- Inline common 1-byte case even faster
- Use DataView for multi-byte reads
- Reduce branching

**Expected Impact**: 2-3% overall

---

### 7. Reduce Array Allocations in cramEncodingSub

**Location**: src/cramFile/sectionParsers.ts:463-483

**Current**: Creates new arrays for symbols and bitLengths:
```typescript
const symbols = []
for (let i = 0; i < numCodes; i++) {
  symbols.push(code[0])
}
const bitLengths = []
for (let i = 0; i < numLengths; i++) {
  bitLengths.push(len[0])
}
```

**Optimization**: Pre-allocate arrays:
```typescript
const symbols = new Array(numCodes)
for (let i = 0; i < numCodes; i++) {
  symbols[i] = code[0]
}
```

**Expected Impact**: 1-2% on long reads (reduces GC pressure)

---

## Implementation Priority

1. **Inline Decoding functions** (Opt #1) - Quick win for short reads, LOW risk
2. **Memoize cramEncodingSub** (Opt #2) - Biggest impact for long reads, MEDIUM risk
3. **Cache external block lookups** (Opt #5) - High impact for long reads, MEDIUM risk
4. **Memoize instantiateCodec** (Opt #3) - Good impact, LOW risk
5. **Optimize tinyMemoize** (Opt #4) - Reduces baseline overhead, LOW risk
6. **Optimize parseItf8** (Opt #6) - Incremental gain
7. **Pre-allocate arrays** (Opt #7) - Minor optimization

---

## Testing Strategy

For each optimization:

1. Implement optimization in isolation
2. Run both profiles: `yarn test profile` for short reads, profile HG002 for long reads
3. Compare using: `node analyze-profile.mjs <before.cpuprofile>` vs after
4. Verify no test failures: `yarn test`
5. Check memory usage doesn't increase significantly
6. Commit if improvement > 3% OR keep iterating

**Target improvements**:
- Short reads: Additional 10-15% (on top of existing 17% improvement)
- Long reads: 30-40% improvement (first major optimization for this workload!)

---

## Lessons from Previous Attempts

**DON'T repeat these failures** (from FAILED_OPTIMIZATIONS.md):
- ❌ Lazy initialization in hot paths (17.5x slower!)
- ❌ Manual loops instead of Array.fill() (63% slower)
- ❌ Partial object pooling without measuring (59% slower)

**DO apply these principles**:
- ✅ Profile every change
- ✅ Inline hot functions
- ✅ Cache property lookups
- ✅ Trust native methods
- ✅ Keep object shapes consistent

---

## Notes

- Memoization is key for long reads (parsing overhead dominates)
- Inlining is key for short reads (function call overhead in RANS)
- Both workloads need different optimizations - test both!
- Consider cache eviction strategies for production (LRU, size limits)
