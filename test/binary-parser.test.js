const { expect } = require('chai')

const { Parser } = require('../src/binary-parser')

describe('binary-parser fork', () => {
  const ip = new Parser().itf8('val')
  ;[
    [[0], { result: { val: 0 }, offset: 1 }],
    [[0x80, 0xff], { result: { val: 255 }, offset: 2 }],
    [[0xff, 0xff, 0xff, 0xff, 0x0f], { result: { val: -1 }, offset: 5 }],
    [[0xff, 0xff, 0xff, 0xff, 0xff], { result: { val: -1 }, offset: 5 }],
  ].forEach(([input, output]) => {
    it(`can parse itf8 [${input.map(n => `0x${n.toString(16)}`)}]
       -> ${output.result.val}`, () => {
      expect(ip.parse(Buffer.from(input))).deep.equal(output)
    })
  })
  const lp = new Parser().ltf8('val')
  ;[
    [
      [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      { result: { val: -1 }, offset: 9 },
    ],
    [
      [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe],
      { result: { val: -2 }, offset: 9 },
    ],
  ].forEach(([input, output]) => {
    it(`can parse ltf8 [${input.map(n => `0x${n.toString(16)}`)}]
       -> ${output.result.val}`, () => {
      expect(lp.parse(Buffer.from(input))).deep.equal(output)
    })
  })
})
