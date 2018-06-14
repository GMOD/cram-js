const { expect } = require('chai')

const { testDataFile } = require('./lib/util')
const { dumpWholeFile } = require('./lib/dumpFile')
const { CramFile } = require('../src/index')

describe('dumping cram files', () => {
  ;`auxf#values.tmp.cram
c1#bounds.tmp.cram
c1#clip.tmp.cram
c1#noseq.tmp.cram
c1#pad1.tmp.cram
c1#pad2.tmp.cram
c1#pad3.tmp.cram
c1#unknown.tmp.cram
c2#pad.tmp.cram
ce#1.tmp.cram
ce#1000.tmp.cram
ce#2.tmp.cram
ce#5.tmp.cram
ce#5b.tmp.cram
ce#large_seq.tmp.cram
ce#supp.tmp.cram
ce#tag_depadded.tmp.cram
ce#tag_padded.tmp.cram
ce#unmap.tmp.cram
ce#unmap1.tmp.cram
ce#unmap2.tmp.cram
headernul.tmp.cram
md#1.tmp.cram
sam_alignment.tmp.cram
xx#blank.tmp.cram
xx#large_aux.tmp.cram
xx#large_aux2.tmp.cram
xx#minimal.tmp.cram
xx#pair.tmp.cram
xx#repeated.tmp.cram
xx#rg.tmp.cram
xx#tlen.tmp.cram
xx#tlen2.tmp.cram
xx#triplet.tmp.cram
xx#unsorted.tmp.cram`
    .split(/\s+/)
    .forEach(filename => {
      // ;['xx#unsorted.tmp.cram'].forEach(filename => {
      it(`can dump the whole ${filename} without error`, async () => {
        const file = new CramFile(testDataFile(filename))
        const fileData = await dumpWholeFile(file)
        // console.log(JSON.stringify(fileData, null, '  '))
        // require('fs').writeFileSync(
        //   `test/data/${filename}.dump.json`,
        //   JSON.stringify(fileData, null, '  '),
        // )
        const expectedFeatures = require(`./data/${filename}.dump.json`)
        expect(JSON.parse(JSON.stringify(fileData))).to.deep.equal(
          expectedFeatures,
        )
      })
    })
})
