import { execSync } from 'child_process'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const testDataDir = join(process.cwd(), 'test', 'data')

interface TestCase {
  cramFile: string
  refId?: number
  start?: number
  end?: number
  expectedCount: number
  samtoolsCommand: string
}

function getSamtoolsCount(cramPath: string, region?: string): number {
  try {
    const regionArg = region || ''
    const cmd = `samtools view -c "${cramPath}" ${regionArg}`.trim()
    const result = execSync(cmd, { encoding: 'utf8' }).trim()
    return parseInt(result, 10)
  } catch (error) {
    console.error(`Failed to run samtools on ${cramPath}:`, error)
    return -1
  }
}

function getRefNames(cramPath: string): string[] {
  try {
    const cmd = `samtools view -H "${cramPath}" | grep "^@SQ" | sed 's/.*SN:\\([^\\t]*\\).*/\\1/'`
    const result = execSync(cmd, {
      encoding: 'utf8',
      shell: '/bin/bash',
    }).trim()
    return result.split('\n').filter(Boolean)
  } catch (error) {
    console.error(`Failed to get ref names from ${cramPath}:`, error)
    return []
  }
}

const testCases: TestCase[] = []

const cramFiles = readdirSync(testDataDir)
  .filter(f => f.endsWith('.cram'))
  .filter(f => existsSync(join(testDataDir, f + '.crai')))

console.log(`Found ${cramFiles.length} CRAM files with indices`)

for (const cramFile of cramFiles) {
  const cramPath = join(testDataDir, cramFile)

  const totalCount = getSamtoolsCount(cramPath)
  if (totalCount >= 0) {
    testCases.push({
      cramFile,
      expectedCount: totalCount,
      samtoolsCommand: `samtools view -c "${cramFile}"`,
    })
  }

  const refNames = getRefNames(cramPath)
  refNames.forEach((refName, refId) => {
    const count = getSamtoolsCount(cramPath, refName)
    if (count >= 0) {
      testCases.push({
        cramFile,
        refId,
        expectedCount: count,
        samtoolsCommand: `samtools view -c "${cramFile}" "${refName}"`,
      })
    }
  })
}

const outputPath = join(process.cwd(), 'test', 'samtools-validation-data.json')
console.log(`Writing ${testCases.length} test cases to ${outputPath}`)
