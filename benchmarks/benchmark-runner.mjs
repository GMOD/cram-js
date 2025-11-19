#!/usr/bin/env node
// Simple benchmark runner that can be called repeatedly by hyperfine
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { LocalFile } from 'generic-filehandle2'
import { IndexedCramFile } from '../esm/index.js'
import CraiIndex from '../esm/craiIndex.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cramPath = join(__dirname, '../test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram')
const craiPath = join(__dirname, '../test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram.crai')

const cram = new IndexedCramFile({
  cramFilehandle: new LocalFile(cramPath),
  index: new CraiIndex({
    filehandle: new LocalFile(craiPath),
  }),
})

const records = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)

// Uncomment to verify
// console.log(`Processed ${records.length} records`)
