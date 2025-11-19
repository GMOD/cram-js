# Next Optimization Targets

Based on profile analysis, here are concrete optimizations to implement:

---

## 1. Batch Block Reading (High Impact for Long Reads)

**Target:** readBlock (1.1s, 25.6% of long-read parsing)

**Current Issue:**

```typescript
// Reads blocks one at a time in a loop
for (let i = 0; i < blocks.length; i++) {
  const block = await this.file.readBlock(blockPosition)
  blocks[i] = block
  blockPosition = blocks[i]._endPosition
}
```

Each readBlock:

1. Reads block header (small read)
2. Reads compressed content (separate read)
3. Reads CRC32 (separate read)

**Optimization:**

```typescript
async readBlocksBatch(startPosition: number, count: number) {
  // Read all block headers first
  const headers = []
  let pos = startPosition
  for (let i = 0; i < count; i++) {
    const header = await this.readBlockHeader(pos)
    headers.push(header)
    pos = header._endPosition + header.compressedSize + 4 // +4 for CRC
  }

  // Calculate total size needed
  const totalStart = headers[0]._endPosition
  const totalEnd = headers[headers.length - 1]._endPosition +
                   headers[headers.length - 1].compressedSize + 4

  // Single large read
  const buffer = await this.file.read(totalEnd - totalStart, totalStart)

  // Parse blocks from buffer
  return headers.map((header, i) => this.parseBlockFromBuffer(buffer, header))
}
```

**Expected Impact:** 15-20% for long reads, 5-10% for short reads

**Implementation Priority:** HIGH

---

## 2. Reduce Object Allocation in RANS (High Impact for Long Reads)

**Target:** DecodingSymbol (422ms) + AriDecoder (178ms) = 600ms (13.8% of
long-read parsing)

**Current Issue:**

AriDecoder creates 256 FC objects eagerly:

```typescript
class AriDecoder {
  constructor() {
    this.fc = new Array(256)
    for (let i = 0; i < this.fc.length; i += 1) {
      this.fc[i] = new FC() // Creates 256 objects even if not all used
    }
    this.R = null
  }
}
```

**Optimization A: Lazy FC Initialization**

```typescript
class AriDecoder {
  constructor() {
    this.fc = new Array(256) // Array of undefined
    this.R = null
  }

  getFC(index) {
    if (!this.fc[index]) {
      this.fc[index] = { F: undefined, C: undefined } // Plain object, not class
    }
    return this.fc[index]
  }
}
```

**Optimization B: Use Plain Objects**

```typescript
// Instead of class with constructor
class DecodingSymbol {
  constructor() {
    this.start = undefined
    this.freq = undefined
  }
}

// Use factory function returning plain object
function createDecodingSymbol() {
  return { start: undefined, freq: undefined }
}
```

**Optimization C: Object Pooling (for long reads)**

Since long reads show allocation as a real bottleneck:

```typescript
class DecoderPool {
  private fcPool: FC[][] = []
  private symbolPool: DecodingSymbol[][] = []

  getOrder0Decoder() {
    const fc =
      this.fcPool.pop() ||
      new Array(256).fill(null).map(() => ({ F: undefined, C: undefined }))
    const syms =
      this.symbolPool.pop() ||
      new Array(256)
        .fill(null)
        .map(() => ({ start: undefined, freq: undefined }))
    return { fc, syms }
  }

  return(fc, syms) {
    this.fcPool.push(fc)
    this.symbolPool.push(syms)
  }
}
```

**Expected Impact:** 10-15% for long reads, minimal for short reads

**Implementation Priority:** HIGH

---

## 3. Parser Optimization (Medium Impact)

**Target:** parser (247ms, 5.7%) + cramEncodingSub (168ms, 3.9%) = 415ms for
long reads

**Current Issue:** Parsing encoding schemes from scratch every time

**Optimization A: Inline Common Encodings**

```typescript
function parseEncoding(buffer) {
  const encodingId = buffer[0]

  // Fast path for common encodings
  switch (encodingId) {
    case ENCODING_EXTERNAL:
      return { codec: 'external', blockContentId: parseItf8(buffer, 1)[0] }
    case ENCODING_HUFFMAN:
      return parseHuffmanFast(buffer)
    case ENCODING_BYTE_ARRAY_STOP:
      return { codec: 'byteArrayStop', stopByte: buffer[1] }
    default:
      return parseEncodingGeneric(buffer)
  }
}
```

**Optimization B: Cache Parsed Schemes**

```typescript
const schemeCache = new Map()

function parseEncodingCached(buffer) {
  const key = hashBuffer(buffer.slice(0, Math.min(16, buffer.length)))
  if (schemeCache.has(key)) {
    return schemeCache.get(key)
  }
  const scheme = parseEncoding(buffer)
  schemeCache.set(key, scheme)
  return scheme
}
```

**Expected Impact:** 3-5% for both workloads

**Implementation Priority:** MEDIUM

---

## 4. Compression Header Optimization (Medium Impact for Short Reads)

**Target:** getCompressionHeaderBlock (241ms, 19.3% of short-read parsing)

**Investigation Needed:** Profile deeper to understand why this is slow

Potential issues:

- Block caching not working effectively
- Re-parsing compression schemes
- Inefficient data structure access

**Implementation Priority:** MEDIUM (investigate first)

---

## 5. Order-0 RANS Specific Optimizations (Medium Impact)

**Target:** uncompressOrder0Way4 (251ms for long reads)

Since Order-0 dominates for long reads (13:1 ratio), optimize specifically:

```typescript
// Current: Generic approach
const c0 = D.R[Decoding.get(rans0, TF_SHIFT)]

// Optimized: Inline and cache
const mask = (1 << TF_SHIFT) - 1
const R = D.R // Cache array reference
const c0 = R[rans0 & mask] // Inline get()
```

**Expected Impact:** 5-10% for long reads

**Implementation Priority:** MEDIUM

---

## Implementation Order

1. **Batch Block Reading** - Biggest single impact for long reads
2. **RANS Object Allocation Fix** - Lazy FC init + plain objects
3. **Parser Fast Paths** - Quick wins with inline checks
4. **Order-0 RANS Tuning** - Apply existing optimizations
5. **Compression Header Investigation** - Needs profiling first

---

## Testing Strategy

After each optimization:

1. Run both short-read and long-read profiles
2. Verify no regression on either workload
3. Run full test suite
4. Measure actual speedup

Target improvements:

- **Short reads:** Additional 10-15% (on top of existing 17%)
- **Long reads:** 35-50% improvement

---

## Notes

- Some optimizations help both workloads (batch reading, RANS objects)
- Some are workload-specific (Order-0 tuning for long reads)
- Focus on highest-impact items first
- Test incrementally to isolate effects
