if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer
const BinaryParser = require('binary-parser').Parser

function parser() {
  return new BinaryParser().endianess('little')
}

export default {
  cramFileDefinition: parser()
    .string('magic', { length: 4 })
    .uint8('majorVersion')
    .uint8('minorVersion')
    .string('fileId', { length: 20, stripNull: true }),
}
