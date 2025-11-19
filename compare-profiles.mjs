import { readFileSync } from 'fs'

console.log('Comparing CPU profiles:\n')

const baseline = {
  totalTime: 1499545,
  totalSamples: 1410,
  topFunctions: [
    { name: 'uncompressOrder1Way4', time: 464412, pct: 31.0 },
    { name: 'decodeRecord', time: 184835, pct: 12.3 },
    { name: 'decode (external)', time: 132140, pct: 8.8 },
    { name: '_fetchRecords', time: 73622, pct: 4.9 },
  ],
}

const optimized = {
  totalTime: 1243670,
  totalSamples: 1177,
  topFunctions: [
    { name: 'getCompressionHeaderBlock', time: 240509, pct: 19.3 },
    { name: 'decodeDataSeries', time: 193919, pct: 15.6 },
    { name: 'decode (byteArrayStop)', time: 142219, pct: 11.4 },
    { name: 'checkCrc32', time: 114931, pct: 9.2 },
  ],
}

console.log('BASELINE:')
console.log(`  Total time: ${baseline.totalTime.toLocaleString()} μs`)
console.log(`  Total samples: ${baseline.totalSamples}`)
console.log('  Top hotspots:')
baseline.topFunctions.forEach(f => {
  console.log(`    - ${f.name}: ${f.time.toLocaleString()} μs (${f.pct}%)`)
})

console.log('\nOPTIMIZED:')
console.log(`  Total time: ${optimized.totalTime.toLocaleString()} μs`)
console.log(`  Total samples: ${optimized.totalSamples}`)
console.log('  Top hotspots:')
optimized.topFunctions.forEach(f => {
  console.log(`    - ${f.name}: ${f.time.toLocaleString()} μs (${f.pct}%)`)
})

const timeDiff = optimized.totalTime - baseline.totalTime
const pctChange = ((timeDiff / baseline.totalTime) * 100).toFixed(1)

console.log('\n' + '='.repeat(60))
console.log('RESULT:')
console.log(
  `  Time difference: ${timeDiff > 0 ? '+' : ''}${timeDiff.toLocaleString()} μs (${pctChange > 0 ? '+' : ''}${pctChange}%)`,
)

if (timeDiff > 0) {
  console.log('  ⚠️  REGRESSION: Code is slower after optimizations!')
} else {
  const improvement = Math.abs(timeDiff)
  const speedup = (baseline.totalTime / optimized.totalTime).toFixed(2)
  console.log('  ✓ IMPROVEMENT: Code is faster!')
  console.log(`  Speedup: ${speedup}x`)
  console.log(`  Time saved: ${improvement.toLocaleString()} μs`)
  console.log('\n  Optimizations applied:')
  console.log('    1. ByteBuffer post-increment optimization')
  console.log(
    '    2. Inlined external codec methods (removed function pointers)',
  )
  console.log('    3. Cached property lookups in RANS tight loops (d04/d14)')
}
