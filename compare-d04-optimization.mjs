console.log('D04 Optimization Analysis')
console.log('='.repeat(80))
console.log()

const baseline = {
  name: 'Baseline (optimized)',
  totalTime: 1243670,
  samples: 1177,
  top3: [
    { name: 'getCompressionHeaderBlock', time: 240509 },
    { name: 'decodeDataSeries', time: 193919 },
    { name: 'decode (byteArrayStop)', time: 142219 },
  ],
}

const current = {
  name: 'After d04 remainder optimization',
  totalTime: 10495364,
  samples: 9652,
  top3: [
    { name: 'r.<computed>', time: 2260700 },
    { name: 'getCodecForTag', time: 965177 },
    { name: '(anonymous) sectionParsers', time: 695092 },
  ],
}

console.log('BASELINE:')
console.log(`  Total time: ${(baseline.totalTime / 1000).toFixed(0)}ms`)
console.log(`  Samples: ${baseline.samples}`)
console.log()

console.log('CURRENT:')
console.log(`  Total time: ${(current.totalTime / 1000).toFixed(0)}ms`)
console.log(`  Samples: ${current.samples}`)
console.log()

console.log('Sample ratio:', (current.samples / baseline.samples).toFixed(1))
console.log('Time ratio:', (current.totalTime / baseline.totalTime).toFixed(1))
console.log()

console.log('ANALYSIS:')
console.log('The profile has ~8x more samples, suggesting either:')
console.log('  1. Test ran 10 iterations vs 1 iteration')
console.log('  2. Different workload (short vs long reads)')
console.log('  3. Something broke badly')
console.log()
console.log('Hotspots are completely different:')
console.log("  - r.<computed> appeared (wasn't in baseline)")
console.log("  - getCodecForTag appeared (wasn't in baseline)")
console.log('  - getCompressionHeaderBlock disappeared')
console.log()
console.log('Per-iteration estimate:')
console.log(
  `  Current: ${(current.totalTime / 10 / 1000).toFixed(0)}ms per iteration (assuming 10 iterations)`,
)
console.log(`  Baseline: ${(baseline.totalTime / 1000).toFixed(0)}ms`)
console.log(
  `  Change: ${((current.totalTime / 10 / baseline.totalTime - 1) * 100).toFixed(1)}%`,
)
