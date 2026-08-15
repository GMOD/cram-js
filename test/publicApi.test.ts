// What a consumer can actually reach through the package entry point. Nothing
// else in the suite asks that question — every other file imports the deep
// module it is testing — which is how the error classes came to be documented,
// carried across a worker boundary by class, and exported nowhere.
import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import {
  CramArgumentError,
  CramBufferOverrunError,
  CramError,
  CramFile,
  CramMalformedError,
  CramUnimplementedError,
} from '../src/index.ts'

test('every error class is reachable from the entry point', () => {
  for (const Cls of [
    CramArgumentError,
    CramBufferOverrunError,
    CramMalformedError,
    CramUnimplementedError,
  ]) {
    // one `catch (e) { if (e instanceof CramError) }` has to cover them all,
    // which it did not while CramUnimplementedError extended Error directly
    expect(new Cls('x')).toBeInstanceOf(CramError)
    expect(new Cls('x')).toBeInstanceOf(Error)
  }
})

test('a file that is not a CRAM is a CramMalformedError', async () => {
  const file = new CramFile({
    filehandle: new LocalFile('test/data/SRR396636.sorted.clip.cram.crai'),
  })
  // a .crai is not a CRAM: the magic-string check is the first thing any read
  // hits, and telling that apart from a network failure is the whole point of
  // the class
  await expect(file.getDefinition()).rejects.toBeInstanceOf(CramMalformedError)
})

test('an unknown reference name is a CramArgumentError', async () => {
  const file = new CramFile({
    filehandle: new LocalFile('test/data/SRR396636.sorted.clip.cram'),
  })
  await expect(file.getReferenceId('not_a_reference')).rejects.toBeInstanceOf(
    CramArgumentError,
  )
})
