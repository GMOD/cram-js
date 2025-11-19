console.log('='.repeat(80))
console.log('CRAM-JS Performance: Short Reads vs Long Reads')
console.log('='.repeat(80))
console.log()

const shortReads = {
  name: 'SRR396637 (Short Reads)',
  totalTime: 1243670,
  samples: 1177,
  top5: [
    { name: 'getCompressionHeaderBlock', time: 240509, pct: 19.3 },
    { name: 'decodeDataSeries', time: 193919, pct: 15.6 },
    { name: 'decode (byteArrayStop)', time: 142219, pct: 11.4 },
    { name: 'checkCrc32', time: 114931, pct: 9.2 },
    { name: 'decodeRecord', time: 73420, pct: 5.9 },
  ],
}

const longReads = {
  name: 'HG002_ONT (Long Reads)',
  totalTime: 4347929,
  samples: 3967,
  top5: [
    { name: 'readBlock', time: 1111680, pct: 25.6 },
    { name: 'DecodingSymbol', time: 422089, pct: 9.7 },
    { name: 'uncompressOrder0Way4', time: 251050, pct: 5.8 },
    { name: 'parser', time: 246714, pct: 5.7 },
    { name: '_uncompress', time: 231078, pct: 5.3 },
  ],
}

console.log('OVERVIEW')
console.log('-'.repeat(80))
console.log(
  `${shortReads.name.padEnd(40)} | Total: ${(shortReads.totalTime / 1000).toFixed(0).padStart(6)}ms | Samples: ${shortReads.samples}`,
)
console.log(
  `${longReads.name.padEnd(40)} | Total: ${(longReads.totalTime / 1000).toFixed(0).padStart(6)}ms | Samples: ${longReads.samples}`,
)
console.log()
console.log(
  `Speed difference: Long reads take ${(longReads.totalTime / shortReads.totalTime).toFixed(1)}x longer`,
)
console.log()

console.log('TOP 5 HOTSPOTS COMPARISON')
console.log('-'.repeat(80))
console.log()

console.log('SHORT READS (Illumina-like):')
console.log('  Rank | Function                           | Time (ms) | % Total')
console.log('  ' + '-'.repeat(72))
shortReads.top5.forEach((item, idx) => {
  console.log(
    `  ${(idx + 1).toString().padStart(4)} | ${item.name.padEnd(34)} | ${((item.time / 1000).toFixed(0) + 'ms').padStart(9)} | ${item.pct.toFixed(1).padStart(5)}%`,
  )
})
console.log()

console.log('LONG READS (ONT):')
console.log('  Rank | Function                           | Time (ms) | % Total')
console.log('  ' + '-'.repeat(72))
longReads.top5.forEach((item, idx) => {
  console.log(
    `  ${(idx + 1).toString().padStart(4)} | ${item.name.padEnd(34)} | ${((item.time / 1000).toFixed(0) + 'ms').padStart(9)} | ${item.pct.toFixed(1).padStart(5)}%`,
  )
})
console.log()

console.log('KEY DIFFERENCES')
console.log('-'.repeat(80))
console.log()
console.log('1. I/O vs Computation:')
console.log(
  '   - Short reads: Computation-heavy (compression header parsing, decoding)',
)
console.log('   - Long reads:  I/O-heavy (readBlock #1 at 25.6%, 1.1 seconds)')
console.log()

console.log('2. Object Allocations:')
console.log('   - Short reads: Low allocation overhead')
console.log(
  '   - Long reads:  High allocation (DecodingSymbol + AriDecoder = 600ms)',
)
console.log()

console.log('3. Compression Strategy:')
console.log('   - Short reads: Mixed Order-0/Order-1 RANS')
console.log('   - Long reads:  Order-0 dominant (251ms vs 19ms for Order-1)')
console.log()

console.log('4. Optimization Strategy:')
console.log(
  '   - Short reads: Focus on decode path, inline functions, cache lookups',
)
console.log(
  '   - Long reads:  Focus on I/O (prefetch), object pooling, parser caching',
)
console.log()

console.log('OPTIMIZATION RECOMMENDATIONS')
console.log('-'.repeat(80))
console.log()
console.log('For SHORT READS (already optimized - 17% improvement achieved):')
console.log('  ✓ Inline codec methods')
console.log('  ✓ Cache property lookups in tight loops')
console.log('  ✓ ByteBuffer post-increment optimization')
console.log('  → Next: Focus on new hotspots (compression header, data series)')
console.log()

console.log('For LONG READS (optimization potential: 35-50%):')
console.log(
  '  1. Implement I/O prefetching/read-ahead (target: 15-20% improvement)',
)
console.log(
  '  2. Add object pooling for RANS decoders (target: 10-15% improvement)',
)
console.log('  3. Cache encoding scheme parsing (target: 3-5% improvement)')
console.log(
  '  4. Optimize Order-0 RANS specifically (target: 5-10% improvement)',
)
console.log()

console.log('='.repeat(80))
