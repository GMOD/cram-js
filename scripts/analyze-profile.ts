import { readFileSync } from 'node:fs'

const profilePath =
  process.argv[2] || './CPU.20260119.114007.75842.0.001.cpuprofile'

interface ProfileNode {
  id: number
  callFrame: {
    functionName: string
    scriptId: string
    url: string
    lineNumber: number
    columnNumber: number
  }
  hitCount: number
  children?: number[]
}

interface CPUProfile {
  nodes: ProfileNode[]
  samples: number[]
  timeDeltas: number[]
}

const profile: CPUProfile = JSON.parse(readFileSync(profilePath, 'utf8'))

console.log('='.repeat(70))
console.log('CPU Profile Analysis')
console.log('='.repeat(70))
console.log(`Total samples: ${profile.samples.length}`)
console.log(
  `Total time: ${profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000}ms`,
)
console.log('')

// Build a map of node id to node
const nodeMap = new Map<number, ProfileNode>()
for (const node of profile.nodes) {
  nodeMap.set(node.id, node)
}

// Calculate self time for each node (samples where this node was at the top of stack)
const selfTimeBySample = new Map<number, number>()
for (let i = 0; i < profile.samples.length; i++) {
  const nodeId = profile.samples[i]!
  const delta = profile.timeDeltas[i] || 0
  selfTimeBySample.set(nodeId, (selfTimeBySample.get(nodeId) || 0) + delta)
}

// Aggregate by function name and file
interface FunctionStats {
  functionName: string
  url: string
  selfTime: number
  hitCount: number
  lineNumber: number
}

const functionStats = new Map<string, FunctionStats>()

for (const node of profile.nodes) {
  const key = `${node.callFrame.functionName}@${node.callFrame.url}:${node.callFrame.lineNumber}`
  const selfTime = selfTimeBySample.get(node.id) || 0

  const existing = functionStats.get(key)
  if (existing) {
    existing.selfTime += selfTime
    existing.hitCount += node.hitCount
  } else {
    functionStats.set(key, {
      functionName: node.callFrame.functionName || '(anonymous)',
      url: node.callFrame.url,
      selfTime,
      hitCount: node.hitCount,
      lineNumber: node.callFrame.lineNumber,
    })
  }
}

// Sort by self time
const sorted = [...functionStats.values()]
  .filter(s => s.selfTime > 0)
  .sort((a, b) => b.selfTime - a.selfTime)

const totalTime = profile.timeDeltas.reduce((a, b) => a + b, 0)

console.log('Top 30 Functions by Self Time:')
console.log('-'.repeat(70))

for (let i = 0; i < Math.min(30, sorted.length); i++) {
  const s = sorted[i]!
  const pct = ((s.selfTime / totalTime) * 100).toFixed(1)
  const timeMs = (s.selfTime / 1000).toFixed(2)
  const shortUrl = s.url.replace(/.*\//, '')
  console.log(
    `${String(i + 1).padStart(2)}. ${pct.padStart(5)}%  ${timeMs.padStart(8)}ms  ${s.functionName.substring(0, 30).padEnd(30)}  ${shortUrl}:${s.lineNumber}`,
  )
}

// Group by file
console.log('\n' + '='.repeat(70))
console.log('Self Time by File:')
console.log('-'.repeat(70))

const fileStats = new Map<string, number>()
for (const s of sorted) {
  const file = s.url.replace(/.*\//, '') || '(native)'
  fileStats.set(file, (fileStats.get(file) || 0) + s.selfTime)
}

const sortedFiles = [...fileStats.entries()].sort((a, b) => b[1] - a[1])
for (const [file, time] of sortedFiles.slice(0, 20)) {
  const pct = ((time / totalTime) * 100).toFixed(1)
  const timeMs = (time / 1000).toFixed(2)
  console.log(`${pct.padStart(5)}%  ${timeMs.padStart(8)}ms  ${file}`)
}

// Find cram-js specific hot spots
console.log('\n' + '='.repeat(70))
console.log('CRAM-JS Specific Hot Spots (esm/ files only):')
console.log('-'.repeat(70))

const cramFunctions = sorted.filter(
  s =>
    s.url.includes('/esm/') ||
    s.url.includes('/cramFile/') ||
    s.url.includes('/codecs/'),
)

for (let i = 0; i < Math.min(20, cramFunctions.length); i++) {
  const s = cramFunctions[i]!
  const pct = ((s.selfTime / totalTime) * 100).toFixed(1)
  const timeMs = (s.selfTime / 1000).toFixed(2)
  const shortUrl = s.url.replace(/.*esm\//, 'esm/')
  console.log(
    `${String(i + 1).padStart(2)}. ${pct.padStart(5)}%  ${timeMs.padStart(8)}ms  ${s.functionName.substring(0, 35).padEnd(35)}  ${shortUrl}:${s.lineNumber}`,
  )
}
