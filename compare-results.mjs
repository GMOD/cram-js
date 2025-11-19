import { readFileSync } from 'fs'

const currentText = readFileSync('profile-current.txt', 'utf-8')
const masterText = readFileSync('profile-master.txt', 'utf-8')

function extractMetrics(text) {
  const samplesMatch = text.match(/Total samples: (\d+)/)
  const timeMatch = text.match(/Total time \(μs\): (\d+)/)
  const secondsMatch = text.match(/Total time \(seconds\): ([\d.]+)/)

  return {
    samples: samplesMatch ? parseInt(samplesMatch[1]) : 0,
    totalTime: timeMatch ? parseInt(timeMatch[1]) : 0,
    seconds: secondsMatch ? parseFloat(secondsMatch[1]) : 0,
  }
}

const current = extractMetrics(currentText)
const master = extractMetrics(masterText)

console.log('PERFORMANCE COMPARISON')
console.log('='.repeat(80))
console.log()
console.log('MASTER BRANCH:')
console.log(
  `  Total time: ${(master.totalTime / 1000).toFixed(0)}ms (${master.seconds.toFixed(2)}s)`,
)
console.log(`  Samples: ${master.samples.toLocaleString()}`)
console.log()
console.log('CURRENT BRANCH:')
console.log(
  `  Total time: ${(current.totalTime / 1000).toFixed(0)}ms (${current.seconds.toFixed(2)}s)`,
)
console.log(`  Samples: ${current.samples.toLocaleString()}`)
console.log()

const timeDiff = current.totalTime - master.totalTime
const pctChange = ((timeDiff / master.totalTime) * 100).toFixed(1)
const speedup = (master.totalTime / current.totalTime).toFixed(2)

console.log('='.repeat(80))
console.log('RESULT:')
console.log(
  `  Time difference: ${timeDiff > 0 ? '+' : ''}${(timeDiff / 1000).toFixed(0)}ms (${pctChange > 0 ? '+' : ''}${pctChange}%)`,
)

if (timeDiff < 0) {
  console.log(`  ✓ IMPROVEMENT: ${speedup}x faster`)
  console.log(`  Time saved: ${Math.abs(timeDiff / 1000).toFixed(0)}ms per run`)
} else if (timeDiff > 0) {
  console.log(
    `  ✗ REGRESSION: ${(current.totalTime / master.totalTime).toFixed(2)}x slower`,
  )
  console.log(`  Time lost: ${(timeDiff / 1000).toFixed(0)}ms per run`)
} else {
  console.log(`  → No significant change`)
}
console.log('='.repeat(80))
console.log()

console.log('DETAILED PROFILES:')
console.log('  Master: profile-master.txt')
console.log('  Current: profile-current.txt')
console.log()
console.log('To see detailed hotspot comparison, run:')
console.log('  diff -y profile-master.txt profile-current.txt | less')
console.log()
