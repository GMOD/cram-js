import { readFileSync } from 'fs'

const filename = process.argv[2] || 'SRR396637-parsing.cpuprofile'
const profile = JSON.parse(readFileSync(filename, 'utf-8'))

const nodes = profile.nodes
const samples = profile.samples
const timeDeltas = profile.timeDeltas

const functionCalls = new Map()

for (let i = 0; i < samples.length; i++) {
  const nodeIndex = samples[i]
  const node = nodes[nodeIndex]

  if (node && node.callFrame) {
    const funcName = node.callFrame.functionName || '(anonymous)'
    const url = node.callFrame.url || ''
    const key = `${funcName}|${url}`

    if (!functionCalls.has(key)) {
      functionCalls.set(key, {
        name: funcName,
        url: url,
        hitCount: 0,
        selfTime: 0,
      })
    }

    const entry = functionCalls.get(key)
    entry.hitCount++
    entry.selfTime += timeDeltas[i] || 0
  }
}

const sorted = Array.from(functionCalls.values())
  .filter(f => f.url.includes('cram-js') && !f.url.includes('node_modules'))
  .sort((a, b) => b.selfTime - a.selfTime)
  .slice(0, 30)

console.log('Top 30 functions by self time (microseconds) in cram-js code:\n')
console.log('Self Time (μs) | Hit Count | Function Name | File')
console.log('-'.repeat(100))

for (const func of sorted) {
  const fileName = func.url.split('/').slice(-2).join('/')
  console.log(
    `${func.selfTime.toString().padStart(14)} | ${func.hitCount.toString().padStart(9)} | ${func.name.padEnd(40)} | ${fileName}`,
  )
}

console.log('\n\nTotal samples:', samples.length)
console.log(
  'Total time (μs):',
  timeDeltas.reduce((a, b) => a + b, 0),
)
