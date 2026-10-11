import fs from 'node:fs'

import ts from 'typescript'
import { expect, test } from 'vitest'

import * as exports from '../src/index.ts'

const api = fs.readFileSync('docs/api.md', 'utf8')

const undocumented: Record<string, Record<string, string>> = {
  CramRecord: {
    readBases: 'the cache getReadBases() fills; read it through getReadBases()',
    mateRecordNumber: 'the decode links mates within a slice through it',
    setSyntheticReadName: 'the decode names lossy-named mates with it',
    addReferenceSequence: 'the decode attaches the reference with it',
  },
  CramFile: {
    options: 'internal state',
    featureCache: 'internal state',
    fetchReferenceSequenceCallback: 'internal state',
    getSliceWorkerPool: 'IndexedCramFile and the slice decode use it',
    getDefinition: 'container-level access for the decode and tests',
    getContainerById: 'container-level access for the decode and tests',
    getContainerAtPosition: 'container-level access for the decode and tests',
    containerCount: 'container-level access for the decode and tests',
    read: 'the byte-range read every container and slice goes through',
    readBlock: 'container-level access for the decode and tests',
    readBlockFromBuffer: 'container-level access for the decode and tests',
    checkCrc32: 'validateChecksums uses it',
    checkCrc32Bytes: 'validateChecksums uses it',
  },
  IndexedCramFile: {
    getRecordsInSlice: 'getRecordsForRange uses it for mate slices',
  },
  CraiIndex: {
    parseIndex: 'getEntriesForRange parses the index through it',
    getIndex: 'getEntriesForRange parses the index through it',
  },
}

function publicMembers(file: string, name: string) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  )
  const decl = source.statements.find(
    (s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) &&
      s.name?.text === name,
  )
  if (!decl) {
    throw new Error(`no ${name} in ${file}`)
  }
  const names = new Set<string>()
  for (const member of decl.members) {
    const hidden = (
      ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []
    ).some(
      m =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword,
    )
    const memberName = member.name?.getText(source)
    if (
      memberName &&
      !hidden &&
      !memberName.startsWith('_') &&
      !ts.isConstructorDeclaration(member)
    ) {
      names.add(memberName)
    }
  }
  return [...names]
}

function inDocs(name: string) {
  return new RegExp(`\`([\\w.]*\\.)?${name}\\b`).test(api)
}

test.each([
  ['src/cramFile/record.ts', 'CramRecord'],
  ['src/cramFile/file.ts', 'CramFile'],
  ['src/cramFile/file.ts', 'CramFileOptions'],
  ['src/indexedCramFile.ts', 'IndexedCramFile'],
  ['src/indexedCramFile.ts', 'CramFileSource'],
  ['src/craiIndex.ts', 'CraiIndex'],
])('docs/api.md covers every public member of %s %s', (file, name) => {
  const skip = undocumented[name] ?? {}
  const members = publicMembers(file, name)
  expect(
    members.filter(m => !(m in skip) && !inDocs(m)),
    'document these in docs/api.md, or list them as undocumented with a reason',
  ).toEqual([])
  expect(
    Object.keys(skip).filter(m => !members.includes(m)),
    'these undocumented entries no longer exist',
  ).toEqual([])
})

test('docs/api.md covers every exported error class', () => {
  const errors = Object.keys(exports).filter(name =>
    /^Cram\w*Error$/.test(name),
  )
  expect(errors.length).toBeGreaterThan(0)
  expect(errors.filter(name => !inDocs(name))).toEqual([])
})
