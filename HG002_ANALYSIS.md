# HG002 Long Reads CRAM Performance Analysis

## Profile Summary

**File:** HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram **Technology:** Oxford Nanopore
Technology (ONT) long reads **Total parsing time:** 4.35 seconds **Samples:**
3,967 **Time in cram-js code:** 77.3%

---

## Top Hotspots

| Function                 | Self Time (μs) | % of Total | Hit Count | Location                   |
| ------------------------ | -------------- | ---------- | --------- | -------------------------- |
| **readBlock**            | 1,111,680      | 25.6%      | 1,004     | cramFile/file.ts           |
| **DecodingSymbol**       | 422,089        | 9.7%       | 398       | rans/decoding.ts           |
| **uncompressOrder0Way4** | 251,050        | 5.8%       | 231       | rans/index.ts              |
| **parser**               | 246,714        | 5.7%       | 224       | cramFile/sectionParsers.ts |
| **\_uncompress**         | 231,078        | 5.3%       | 209       | cramFile/file.ts           |
| **readStatsO0**          | 178,161        | 4.1%       | 163       | rans/frequencies.ts        |
| **AriDecoder**           | 177,652        | 4.1%       | 162       | rans/decoding.ts           |
| **cramEncodingSub**      | 168,020        | 3.9%       | 155       | cramFile/sectionParsers.ts |

---

## Comparison with Short Reads (SRR396637)

### Key Differences

| Aspect                   | Short Reads (SRR396637)           | Long Reads (HG002)                |
| ------------------------ | --------------------------------- | --------------------------------- |
| **Total Time**           | 1.24 seconds                      | 4.35 seconds                      |
| **#1 Hotspot**           | getCompressionHeaderBlock (19.3%) | readBlock (25.6%)                 |
| **#2 Hotspot**           | decodeDataSeries (15.6%)          | DecodingSymbol (9.7%)             |
| **RANS Time**            | Moderate                          | Higher (Order-0 dominant)         |
| **Allocation Hot Spots** | Low                               | High (DecodingSymbol, AriDecoder) |

### Why Long Reads Are Different

1. **More I/O Intensive**
   - `readBlock` is #1 hotspot (1.1s, 25.6%)
   - Long reads = larger records = more data blocks to read
   - Short reads had this at <1% of time

2. **More Object Allocations**
   - `DecodingSymbol` constructor: 422ms (9.7%)
   - `AriDecoder` constructor: 178ms (4.1%)
   - Combined: ~600ms in object creation
   - Short reads: These weren't in top 10

3. **Order-0 RANS Dominates**
   - `uncompressOrder0Way4`: 251ms (5.8%)
   - `uncompressOrder1Way4`: 19ms (0.4%)
   - Ratio: ~13:1 in favor of Order-0
   - Short reads had more balanced compression

4. **Parser Overhead Higher**
   - `parser`: 247ms (5.7%)
   - `cramEncodingSub`: 168ms (3.9%)
   - Combined parsing: ~415ms (9.5%)
   - Short reads: parsing was 2-3% of time

---

## Optimization Opportunities

### 1. **readBlock I/O Optimization** (1.1 seconds, 25.6%)

**Current Bottleneck:** Reading blocks from file is the #1 time consumer

**Potential Optimizations:**

a) **Prefetch/Read-ahead Strategy**

```typescript
// Speculatively read next blocks while processing current
async readBlockWithPrefetch(position) {
  const currentBlock = await readBlock(position)
  // Kick off read for next block in background
  this.prefetchPromise = readBlock(nextPosition)
  return currentBlock
}
```

**Expected Impact:** 10-15% improvement

b) **Batch Block Reads**

```typescript
// Read multiple consecutive blocks in one syscall
async readBlocksBatch(positions: number[]) {
  // Calculate range and read once
  const start = Math.min(...positions)
  const end = Math.max(...positions) + estimatedBlockSize
  const buffer = await filehandle.read(start, end - start)
  // Parse individual blocks from buffer
  return parseBlocksFromBuffer(buffer, positions)
}
```

**Expected Impact:** 15-20% improvement

c) **Memory-mapped I/O**

```typescript
// Use mmap for large files
const mmappedFile = fs.createMemoryMap(filepath)
// Direct buffer access without read syscalls
```

**Expected Impact:** 20-30% improvement (but higher memory usage)

### 2. **Object Pool for RANS Decoders** (600ms, 13.8%)

Unlike our failed attempt with short reads, long reads show clear allocation
hotspots:

- `DecodingSymbol`: 422ms
- `AriDecoder`: 178ms

**Why pooling might work here:**

- 1,004 samples × allocations = thousands of objects created
- Order-0 RANS dominates (simpler to pool)
- Allocation itself is the bottleneck (not the pooling logic)

**Implementation:**

```typescript
class RANSDecoderPool {
  private decoderPool: AriDecoder[] = []
  private symbolPool: DecodingSymbol[][] = []

  getOrder0Decoder() {
    const decoder = this.decoderPool.pop() || new AriDecoder()
    const syms = this.symbolPool.pop() || this.createSymbolArray()
    return { decoder, syms }
  }

  returnOrder0Decoder(decoder, syms) {
    decoder.R = null // Clear large array
    this.decoderPool.push(decoder)
    this.symbolPool.push(syms)
  }

  private createSymbolArray() {
    const syms = new Array(256)
    for (let i = 0; i < 256; i++) {
      syms[i] = new DecodingSymbol()
    }
    return syms
  }
}
```

**Expected Impact:** 10-15% improvement

### 3. **Parser Optimization** (415ms, 9.5%)

**Current Hotspots:**

- `parser`: 247ms (5.7%)
- `cramEncodingSub`: 168ms (3.9%)

**Potential Optimizations:**

a) **Memoize Encoding Schemes**

```typescript
const encodingCache = new Map<string, EncodingScheme>()

function parseEncoding(buffer) {
  const hash = hashBuffer(buffer)
  if (encodingCache.has(hash)) {
    return encodingCache.get(hash)
  }
  const scheme = parseEncodingScheme(buffer)
  encodingCache.set(hash, scheme)
  return scheme
}
```

**Expected Impact:** 3-5% improvement

b) **Fast-path for Common Encodings**

```typescript
// Check for common encoding patterns first
if (isExternalEncoding(buffer)) {
  return parseExternalFast(buffer)
} else if (isHuffmanEncoding(buffer)) {
  return parseHuffmanFast(buffer)
} else {
  return parseEncodingGeneric(buffer)
}
```

**Expected Impact:** 2-4% improvement

### 4. **Order-0 RANS Optimization** (251ms, 5.8%)

**Current:** Order-0 is used heavily for long reads

**Optimizations:**

- Apply our existing optimizations (property caching, inlining)
- Consider SIMD operations for the decode loop
- Use TypedArrays more aggressively

**Expected Impact:** 5-10% improvement

---

## Recommended Optimization Priority

For long-read CRAM files:

1. **readBlock I/O optimization** (25.6% of time)
   - Start with prefetching strategy
   - Measure impact before trying mmap

2. **Object pooling for RANS** (13.8% of time)
   - More viable for long reads than short reads
   - Focus on Order-0 decoders first

3. **Parser caching** (9.5% of time)
   - Memoize encoding schemes
   - Add fast paths for common patterns

4. **Order-0 RANS tuning** (5.8% of time)
   - Apply property caching optimizations
   - Consider TypedArray usage

**Combined Expected Improvement: 35-50% faster for long-read CRAM files**

---

## Profile Characteristics

### Long Reads vs Short Reads

| Characteristic    | Short Reads          | Long Reads       | Implication                       |
| ----------------- | -------------------- | ---------------- | --------------------------------- |
| **Dominant Cost** | Decompression/Decode | I/O + Allocation | Different optimization strategies |
| **Block Size**    | Small, numerous      | Large, fewer     | Prefetching more beneficial       |
| **Compression**   | Order-1 RANS         | Order-0 RANS     | Simpler decompression, more I/O   |
| **Record Size**   | ~100-300 bp          | 1,000-100,000 bp | More data per record              |
| **Allocations**   | Low                  | High             | Pooling more beneficial           |

### File Structure Impact

Long reads (ONT) characteristics:

- Longer sequences → larger blocks
- Simpler compression (Order-0) → faster decode but less compression
- More I/O per record → I/O becomes bottleneck
- Higher allocation rate → GC pressure

---

## Next Steps

1. **Implement I/O prefetching** - Highest impact, moderate complexity
2. **Add object pooling for long reads** - High impact, easy to test
3. **Profile after each change** - Verify assumptions
4. **Consider workload-specific optimizations** - Detect long vs short reads and
   use appropriate strategies
