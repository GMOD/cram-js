#!/usr/bin/env node
// Simple benchmark runner that can be called repeatedly by hyperfine
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pkg from '../dist/index.js'
import CraiIndex from '../dist/craiIndex.js'

const { IndexedCramFile } = pkg

const __dirname = dirname(fileURLToPath(import.meta.url))
const cramPath = join(__dirname, '../test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram')
const craiPath = join(__dirname, '../test/data/HG002_ONTrel2_16x_RG_HP10xtrioRTG.cram.crai')

const cram = new IndexedCramFile({
  cramFilehandle: cramPath,
  index: new CraiIndex({
    filehandle: craiPath,
  }),
})

const records = await cram.getRecordsForRange(0, 0, Number.POSITIVE_INFINITY)

// Uncomment to verify
// console.log(`Processed ${records.length} records`)
