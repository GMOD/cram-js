# CRAM-JS Performance Analysis & Optimization Results

## Summary

**Performance Improvement: 17.1% faster (1.21x speedup)**

- Baseline: 1,499,545 μs (~1.5 seconds)
- Optimized: 1,243,670 μs (~1.2 seconds)
- Time saved: 255,875 μs

---

# CRAM-JS Performance Analysis & Optimization Opportunities

## CPU Profile Summary

Profiling of SRR396637.sorted.clip.cram parsing revealed the following hot
spots:

| Function             | Self Time (μs) | % of Total | Location                           |
| -------------------- | -------------- | ---------- | ---------------------------------- |
| uncompressOrder1Way4 | 464,412        | 31.0%      | src/rans/index.ts                  |
| decodeRecord         | 184,835        | 12.3%      | src/cramFile/slice/decodeRecord.ts |
| decode (external)    | 132,140        | 8.8%       | src/cramFile/codecs/external.ts    |
| \_fetchRecords       | 73,622         | 4.9%       | src/cramFile/slice/index.ts        |
| decodeDataSeries     | 49,741         | 3.3%       | src/cramFile/slice/index.ts        |
| uncompress (d04)     | 49,493         | 3.3%       | src/rans/d04.ts                    |
| \_decodeByte         | 48,878         | 3.3%       | src/cramFile/codecs/external.ts    |
| readStatsO1          | 42,359         | 2.8%       | src/rans/frequencies.ts            |
| \_decodeInt          | 40,781         | 2.7%       | src/cramFile/codecs/external.ts    |

**Total profiled time: 1,499,545 μs (~1.5 seconds)**

---

## Top Optimization Opportunities

### 1. RANS Decompression Optimization (~31% of runtime)

**Location:** `src/rans/index.ts:129`, `src/rans/d14.ts`, `src/rans/decoding.ts`

**Current Issues:**

- Object allocations in hot path: Creates 256 `AriDecoder` objects and 256x256
  `DecodingSymbol` objects for every Order-1 decompression
- Function call overhead in tight loops
- Array bounds checking on every access

**Optimization Strategies:**

#### 1.1 Object Pooling for RANS Structures

```typescript
// Create a pool of reusable decoder objects instead of allocating new ones
class RansDecoderPool {
  private decoders: AriDecoder[]
  private symbols: DecodingSymbol[][]

  getDecoder() {
    /* reuse from pool */
  }
  returnDecoder() {
    /* return to pool */
  }
}
```

**Expected Impact:** 5-10% improvement by reducing GC pressure

#### 1.2 Inline Hot Functions

The following functions in `decoding.ts` should be inlined manually or marked
for inlining:

- `get()` - line 73
- `advanceSymbolStep()` - line 64
- `renormalize()` - line 115

Modern JS engines may inline these, but ensuring they're small and simple helps.

**Expected Impact:** 2-5% improvement

#### 1.3 Optimize ByteBuffer Class

The ByteBuffer wrapper adds overhead on every byte access:

```typescript
// Current (src/rans/index.ts:160-163)
get() {
  const b = this._buffer[this._position]
  this._position += 1
  return b
}
```

**Optimization:** Pass raw Uint8Array + position object instead of wrapping in
ByteBuffer class. Update position via mutable object.

**Expected Impact:** 3-7% improvement

#### 1.4 Pre-allocate Arrays

In `readStatsO1` (frequencies.ts:95), avoid repeated `Array.fill()` calls:

```typescript
// Pre-allocate R array once and reuse
if (D[i].R == null) {
  D[i].R = new Array(TOTFREQ)
}
D[i].R.fill(j, x, x + D[i].fc[j].F) // This is expensive in a hot loop
```

**Expected Impact:** 1-3% improvement

---

### 2. Record Decoding Optimization (~12% of runtime)

**Location:** `src/cramFile/slice/decodeRecord.ts:126-200`

**Current Issues:**

- String concatenation in loops (`readNullTerminatedString`, `decodeRFData`)
- Repeated `String.fromCharCode()` calls
- Array allocations for read features

**Optimization Strategies:**

#### 2.1 Use TextDecoder for String Conversion

```typescript
// Instead of (line 22-26):
function readNullTerminatedString(buffer: Uint8Array) {
  let r = ''
  for (let i = 0; i < buffer.length && buffer[i] !== 0; i++) {
    r += String.fromCharCode(buffer[i]!)
  }
  return r
}

// Use:
const textDecoder = new TextDecoder('utf-8')
function readNullTerminatedString(buffer: Uint8Array) {
  let endPos = 0
  while (endPos < buffer.length && buffer[endPos] !== 0) {
    endPos++
  }
  return textDecoder.decode(buffer.subarray(0, endPos))
}
```

**Expected Impact:** 3-5% improvement

#### 2.2 Avoid String Concatenation in Loops

In `decodeRFData` (line 145-148), use array join instead:

```typescript
// Instead of:
let r = ''
for (let i = 0; i < data.byteLength; i++) {
  r += String.fromCharCode(data[i])
}

// Use:
return String.fromCharCode(...data)
```

**Expected Impact:** 1-2% improvement

#### 2.3 Pre-size Read Features Array

The array is already pre-sized (line 135), which is good. No change needed.

---

### 3. External Codec Optimization (~15% of runtime combined)

**Location:** `src/cramFile/codecs/external.ts`

**Current Issues:**

- Indirect function calls through `_decodeData` pointer
- Cursor object updates on every byte read
- Bounds checking on every access

**Optimization Strategies:**

#### 3.1 Inline Decode Methods

Remove the function pointer indirection and use direct type checking:

```typescript
// Instead of constructor setting this._decodeData
decode(slice, coreDataBlock, blocksByContentId, cursors) {
  const { blockContentId } = this.parameters
  const contentBlock = blocksByContentId[blockContentId]
  if (!contentBlock) return undefined

  const cursor = cursors.externalBlocks.getCursor(blockContentId)

  // Direct inline based on dataType
  if (this.dataType === 'int') {
    const [result, bytesRead] = parseItf8(contentBlock.content, cursor.bytePosition)
    cursor.bytePosition += bytesRead
    return result
  } else {
    if (cursor.bytePosition >= contentBlock.content.length) {
      throw new CramBufferOverrunError('...')
    }
    return contentBlock.content[cursor.bytePosition++]!
  }
}
```

**Expected Impact:** 2-4% improvement

#### 3.2 Optimize parseItf8

The function is already well-optimized with early returns. Consider using
DataView for multi-byte reads:

```typescript
// For 2-byte case (line 37):
// Current:
result = ((countFlags & 0x3f) << 8) | buffer[offset + 1]!

// Could use DataView (may or may not be faster - needs benchmarking):
const view = new DataView(buffer.buffer, buffer.byteOffset)
result = view.getUint16(offset) & 0x3fff
```

**Note:** This needs benchmarking as DataView may add overhead for small reads.

**Expected Impact:** 0-2% improvement

#### 3.3 Batch Cursor Updates

Instead of updating cursor.bytePosition on every read, batch updates:

```typescript
// Read multiple bytes and update position once
const startPos = cursor.bytePosition
// ... read operations ...
cursor.bytePosition = startPos + totalBytesRead
```

**Expected Impact:** 1-2% improvement

---

### 4. Additional Opportunities

#### 4.1 Reduce Object Property Access

Cache frequently accessed properties:

```typescript
// In d14.ts loop (line 26-51), cache array lookups:
const D_l0 = D[l0]
const syms_l0 = syms[l0]
const c0 = 0xff & D_l0.R[Decoding.get(rans0, TF_SHIFT)]
```

**Expected Impact:** 1-2% improvement

#### 4.2 Use Typed Arrays More Consistently

Replace generic arrays with typed arrays where possible (Uint8Array,
Uint32Array, etc.)

**Expected Impact:** 1-3% improvement

#### 4.3 Consider WebAssembly for RANS Decompression

The RANS decompression is compute-intensive and could benefit from WASM:

- Compile the RANS decoder to WASM
- Use SIMD instructions where available
- Reduce GC overhead

**Expected Impact:** 20-40% improvement for decompression (10-15% overall)

---

## Summary of Quick Wins

Priority optimizations to implement first (estimated cumulative impact):

1. **Object pooling for RANS decoders** (5-10%)
2. **TextDecoder for strings** (3-5%)
3. **Inline external codec methods** (2-4%)
4. **Optimize ByteBuffer class** (3-7%)
5. **Cache property accesses in tight loops** (1-2%)

**Total Expected Improvement: 15-30% faster parsing**

---

## Benchmarking Strategy

After implementing optimizations:

1. Run `yarn test benchmark` to measure timing improvements
2. Re-run profiling with `yarn test profile` to verify hot spots have moved
3. Test with multiple CRAM files of different sizes
4. Ensure correctness with existing test suite
5. Monitor memory usage to ensure optimizations don't increase memory pressure

---

## Long-term Considerations

1. **WebAssembly RANS decoder** - Most impactful but requires significant effort
2. **Worker threads** - Parallelize decompression of multiple containers
3. **Streaming API** - Process records as they're decoded instead of buffering
   all
4. **Native addons** - Use N-API for critical paths (similar impact to WASM)

---

## Implementation Results

### What Was Implemented

After testing various optimizations, the following changes were kept:

#### 1. ByteBuffer Post-increment Optimization (src/rans/index.ts)

**Before:**

```typescript
get() {
  const b = this._buffer[this._position]
  this._position += 1
  return b
}
```

**After:**

```typescript
get() {
  return this._buffer[this._position++]
}
```

**Impact:** Reduced variable allocations and operations in hot path.

#### 2. Inlined External Codec Methods (src/cramFile/codecs/external.ts)

**Before:**

```typescript
constructor(parameters, dataType) {
  super(parameters, dataType)
  if (this.dataType === 'int') {
    this._decodeData = this._decodeInt  // Function pointer
  } else if (this.dataType === 'byte') {
    this._decodeData = this._decodeByte
  }
}

decode(...args) {
  return this._decodeData(contentBlock, cursor)  // Indirect call
}
```

**After:**

```typescript
decode(...args) {
  if (this.dataType === 'int') {
    const [result, bytesRead] = parseItf8(...)
    cursor.bytePosition += bytesRead
    return result
  } else {
    return contentBlock.content[cursor.bytePosition++]!
  }
}
```

**Impact:** Eliminated function pointer indirection overhead.

#### 3. Cached Property Lookups in RANS Tight Loops

**In src/rans/d14.ts:**

```typescript
// Cache frequently accessed arrays
const D_l0_R = D[l0].R
const D_l1_R = D[l1].R
const c0 = 0xff & D_l0_R[rans0 & mask]

// Cache symbol lookups
const sym_l0_c0 = syms[l0][c0]

// Inline advanceSymbolStep computation
rans0 = sym_l0_c0.freq * (rans0 >> TF_SHIFT) + (rans0 & mask) - sym_l0_c0.start
```

**In src/rans/d04.ts:**

```typescript
const mask = (1 << TF_SHIFT) - 1
const D_R = D.R // Cache R array reference

const c0 = D_R[rans0 & mask] // Use cached reference
```

**Impact:** Reduced repeated property accesses and function call overhead.

---

### What Didn't Work

#### ❌ Object Pooling for RANS Decoders

**Attempted:** Created a pool to reuse AriDecoder and DecodingSymbol objects.

**Result:** 59% SLOWER - added significant overhead without benefit.

**Why it failed:** Still allocated new syms arrays on every call, so got pooling
overhead without actual reuse benefits.

#### ❌ Replacing Array.fill() with Explicit Loops

**Attempted:** Replaced `Array.fill(j, x, x + F)` with explicit for loops in
frequencies.ts.

**Result:** 63% SLOWER - `readStatsO0` became the top hotspot at 696ms.

**Why it failed:** `Array.fill()` is a highly optimized native method. Manual
loops in JS are much slower for this use case.

#### ❌ TextDecoder for String Conversion

**Not attempted:** User reported that TextDecoder is slower for small strings
based on prior experiments.

**Lesson:** Native APIs aren't always faster, especially for small data.

---

### Performance Analysis Comparison

| Metric          | Baseline                   | Optimized                         | Change      |
| --------------- | -------------------------- | --------------------------------- | ----------- |
| **Total Time**  | 1,499,545 μs               | 1,243,670 μs                      | **-17.1%**  |
| **Samples**     | 1410                       | 1177                              | -16.5%      |
| **Top Hotspot** | uncompressOrder1Way4 (31%) | getCompressionHeaderBlock (19.3%) | Distributed |

**Key Observation:** The optimizations successfully reduced time in the original
hotspots (RANS decompression, external codec), distributing the load more evenly
across the codebase.

---

### Lessons Learned

1. **Profile, Don't Guess:** Small changes can have large impacts (both positive
   and negative)
2. **Native Optimizations Matter:** `Array.fill()` is faster than manual loops
   in JS
3. **Object Pooling Needs Care:** Partial pooling can add overhead without
   benefits
4. **Inline Hot Paths:** Removing function call overhead in tight loops helps
5. **Cache Repeated Access:** Property lookups add up in millions of iterations
6. **Incremental Testing:** Test one optimization at a time to isolate impact

---

### Future Optimization Opportunities

The new top hotspots offer additional optimization potential:

1. **getCompressionHeaderBlock** (240ms, 19.3%) - Container header parsing
2. **decodeDataSeries** (194ms, 15.6%) - Data series decoding
3. **decode (byteArrayStop)** (142ms, 11.4%) - Byte array codec
4. **checkCrc32** (115ms, 9.2%) - CRC validation

Additional long-term strategies:

- **WebAssembly for RANS** - Could provide 20-40% additional improvement
- **Worker threads** - Parallelize container decompression
- **Streaming API** - Process records incrementally to reduce memory pressure
