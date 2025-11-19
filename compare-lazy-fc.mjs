console.log('LAZY FC OPTIMIZATION REGRESSION ANALYSIS')
console.log('='.repeat(80))
console.log()

const before = {
  name: 'Before Lazy FC',
  totalTime: 1243670,
  samples: 1177,
  top3: [
    { name: 'getCompressionHeaderBlock', time: 240509 },
    { name: 'decodeDataSeries', time: 193919 },
    { name: 'decode (byteArrayStop)', time: 142219 },
  ],
}

const after = {
  name: 'After Lazy FC',
  totalTime: 21848559,
  samples: 19485,
  top3: [
    { name: 'parser', time: 7003773 },
    { name: 'cramEncodingSub', time: 1614211 },
    { name: '(anonymous)', time: 201960 },
  ],
}

console.log('BEFORE:')
console.log(`  Total time: ${(before.totalTime / 1000).toFixed(0)}ms`)
console.log(`  Samples: ${before.samples}`)
console.log()

console.log('AFTER:')
console.log(`  Total time: ${(after.totalTime / 1000).toFixed(0)}ms`)
console.log(`  Samples: ${after.samples}`)
console.log()

const slowdown = after.totalTime / before.totalTime
console.log(`REGRESSION: ${slowdown.toFixed(1)}x SLOWER`)
console.log()

console.log('Parser went from 46ms to 7,004ms (150x slower!)')
console.log()
console.log(
  'This is clearly wrong. The lazy FC change should not affect parsing.',
)
console.log('Need to revert and investigate.')
