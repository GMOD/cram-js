import fs from 'node:fs'

import ts from 'typescript'
import { expect, test } from 'vitest'

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

function source(file: string) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
}

function publicNames(members: ts.NodeArray<ts.ClassElement | ts.TypeElement>) {
  const names: string[] = []
  for (const member of members) {
    const hidden = (
      ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []
    ).some(
      m =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword,
    )
    const name = member.name?.getText()
    if (
      name &&
      !hidden &&
      !name.startsWith('_') &&
      !ts.isConstructorDeclaration(member)
    ) {
      names.push(name)
    }
  }
  return names
}

// a class's members, plus the keys of its constructor's inline options type
function publicMembers(file: string, name: string) {
  const decl = source(file).statements.find(
    (s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) &&
      s.name?.text === name,
  )
  if (!decl) {
    throw new Error(`no ${name} in ${file}`)
  }
  const names = publicNames(decl.members)
  if (ts.isClassDeclaration(decl)) {
    const options = decl.members.find(ts.isConstructorDeclaration)
      ?.parameters[0]?.type
    if (options && ts.isTypeLiteralNode(options)) {
      names.push(...publicNames(options.members))
    }
  }
  return [...new Set(names)]
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
  ['src/cramFile/mismatches.ts', 'Mismatch'],
  ['src/cramFile/mismatches.ts', 'MismatchOptions'],
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

test('docs/api.md covers every export', () => {
  const exported: string[] = []
  for (const statement of source('src/index.ts').statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exported.push(element.name.text)
      }
    }
  }
  expect(exported.length).toBeGreaterThan(0)
  expect(exported.filter(name => !inDocs(name))).toEqual([])
})
