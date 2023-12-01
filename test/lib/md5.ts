import fs from 'fs'
import { sequenceMD5 } from '../../src/cramFile/util'

const seq = fs.readFileSync(process.argv[2]).toString()

// console.log(process.argv)
console.log(seq.replace(/\s/g, '').length, sequenceMD5(seq))
