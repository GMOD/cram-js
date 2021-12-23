const { Parser } = require('@gmod/binary-parser')

const { parseItf8 } = require('../src/cramFile/util')

describe('binary-parser fork', () => {
  describe('itf8', () => {
    const ip = new Parser().itf8('val')
    ;[
      [[0], { result: { val: 0 }, offset: 1 }],
      [[0x80, 0xff], { result: { val: 255 }, offset: 2 }],
      [[0xff, 0xff, 0xff, 0xff, 0x0f], { result: { val: -1 }, offset: 5 }],
      [[0xff, 0xff, 0xff, 0xff, 0xff], { result: { val: -1 }, offset: 5 }],
      [[0xff, 0xff, 0xff, 0xff, 0xfe], { result: { val: -2 }, offset: 5 }],
      [[192, 170, 130, 140, 174], { result: { val: 43650 }, offset: 3 }],
    ].forEach(([input, output]) => {
      it(`can parse itf8 [${input.map(n => `0x${n.toString(16)}`)}]
       -> ${output.result.val}`, () => {
        expect(ip.parse(Buffer.from(input))).toEqual(output)

        const otherParseResult = parseItf8(Buffer.from(input), 0)
        expect(otherParseResult[0]).toEqual(output.result.val)
        expect(otherParseResult[1]).toEqual(output.offset)
      })
    })
    it('can parse several itf8 numbers in a row', () => {
      const p = new Parser().itf8('val1').itf8('val2').itf8('val3')
      const data = [0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0]
      expect(p.parse(Buffer.from(data))).toEqual({
        offset: 8,
        result: { val1: 255, val2: -1, val3: 0 },
      })
    })
  })

  describe('ltf8', () => {
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
      [[0x0], { result: { val: 0 }, offset: 1 }],
    ].forEach(([input, output]) => {
      it(`can parse ltf8 [${input.map(n => `0x${n.toString(16)}`)}]
       -> ${output.result.val}`, () => {
        expect(lp.parse(Buffer.from(input))).toEqual(output)
      })
    })
  })

  // describe('itf8 extended', () => {
  //   it('can parse several itf8 numbers in a row')

  // })
})
