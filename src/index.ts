import { Buffer } from 'buffer'

window.Buffer = Buffer
export { default as CramFile, CramRecord } from './cramFile'
export { default as CraiIndex } from './craiIndex'
export { default as IndexedCramFile } from './indexedCramFile'
