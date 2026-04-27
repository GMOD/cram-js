import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error(
    'Usage: node --experimental-strip-types scripts/analyze-profile.ts <file1.cpuprofile> [file2.cpuprofile ...]',
  )
  process.exit(1)
}

interface ProfileNode {
  id: number
  callFrame: {
    functionName: string
    url: string
    lineNumber: number
    columnNumber: number
  }
  hitCount?: number
  children?: number[]
}

interface Profile {
  nodes: ProfileNode[]
}

for (const file of files) {
  console.log(`\n=== ${file} ===`)
  const profile: Profile = JSON.parse(readFileSync(file, 'utf8'))

  const funcHits = new Map<string, number>()
  for (const node of profile.nodes) {
    const name = node.callFrame.functionName || '(anonymous)'
    const url = node.callFrame.url || ''
    const shortUrl = url.split('/').pop() || 'native'
    const key = `${name} (${shortUrl}:${node.callFrame.lineNumber})`
    funcHits.set(key, (funcHits.get(key) || 0) + (node.hitCount || 0))
  }

  const sorted = [...funcHits.entries()]
    .filter(([, hits]) => hits > 0)
    .sort((a, b) => b[1] - a[1])

  const total = sorted.reduce((sum, [, hits]) => sum + hits, 0)

  console.log(`Total samples: ${total}`)
  console.log('\nTop functions by CPU time:')
  for (const [func, hits] of sorted.slice(0, 25)) {
    const pct = ((hits / total) * 100).toFixed(1)
    const bar = '#'.repeat(Math.round((hits / total) * 50))
    console.log(`  ${pct.padStart(5)}% ${bar.padEnd(25)} ${func}`)
  }
}
