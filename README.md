# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
[![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/cram-js/master.svg?style=flat-square)](https://codecov.io/gh/GMOD/cram-js/branch/master)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/push.yml?branch=master)](https://github.com/GMOD/cram-js/actions?query=branch%3Amaster+workflow%3APush+)

Read CRAM files (indexed or unindexed) with pure JS, works in node or in the browser.

- Reads CRAM 3.x and 2.x (3.1 added in v1.6.0)
- Does not read CRAM 1.x
- Can use .crai indexes out of the box, for efficient sequence fetching, but also has an [index API](#craiindex) that would allow use with other index types
- Does implement bzip2 but not lzma codecs (yet); if this is important to your use case, please file an issue

## Install

```bash
$ npm install --save @gmod/cram
# or
$ yarn add @gmod/cram
```

## Usage

```js
const { IndexedCramFile, CramFile, CraiIndex } = require('@gmod/cram')

// Use indexedfasta library for seqFetch, if using local file (see below)
const { IndexedFasta, BgzipIndexedFasta } = require('@gmod/indexedfasta')

// this uses local file paths for node.js for IndexedFasta, for usages using
// remote URLs see indexedfasta docs for filehandles and
// https://github.com/gmod/generic-filehandle
const t = new IndexedFasta({
  path: '/filesystem/yourfile.fa',
  faiPath: '/filesystem/yourfile.fa.fai',
})

// example of fetching records from an indexed CRAM file.
// NOTE: only numeric IDs for the reference sequence are accepted.
// For indexedfasta the numeric ID is the order in which the sequence names
// appear in the header

// Wrap in an async and then run
run = async () => {
  const idToName = []
  const nameToId = {}

  // example opening local files on node.js
  // can also pass `cramUrl` (for the IndexedCramFile class), and `url` (for
  // the CraiIndex) params to open remote URLs
  //
  // alternatively `cramFilehandle` (for the IndexedCramFile class) and
  // `filehandle` (for the CraiIndex) can be used,  see for examples
  // https://github.com/gmod/generic-filehandle

  const indexedFile = new IndexedCramFile({
    cramPath: '/filesystem/yourfile.cram',
    //or
    //cramUrl: 'url/to/file.cram'
    //cramFilehandle: a generic-filehandle or similar filehandle
    index: new CraiIndex({
      path: '/filesystem/yourfile.cram.crai',
      // or
      // url: 'url/to/file.cram.crai'
      // filehandle: a generic-filehandle or similar filehandle
    }),
    seqFetch: async (seqId, start, end) => {
      // note:
      // * seqFetch should return a promise for a string, in this instance retrieved from IndexedFasta
      // * we use start-1 because cram-js uses 1-based but IndexedFasta uses 0-based coordinates
      // * the seqId is a numeric identifier, so we convert it back to a name with idToName
      // * you can return an empty string from this function for testing if you want, but you may not get proper interpretation of record.readFeatures
      return t.getSequence(idToName[seqId], start - 1, end)
    },
    checkSequenceMD5: false,
  })
  const samHeader = await indexedFile.cram.getSamHeader()

  // use the @SQ lines in the header to figure out the
  // mapping between ref ref ID numbers and names

  const sqLines = samHeader.filter(l => l.tag === 'SQ')
  sqLines.forEach((sqLine, refId) => {
    sqLine.data.forEach(item => {
      if (item.tag === 'SN') {
        // this is the ref name
        const refName = item.value
        nameToId[refName] = refId
        idToName[refId] = refName
      }
    })
  })

  const records = await indexedFile.getRecordsForRange(
    nameToId['chr1'],
    10000,
    20000,
  )
  records.forEach(record => {
    console.log(`got a record named ${record.readName}`)
    if (record.readFeatures != undefined) {
      record.readFeatures.forEach(({ code, pos, refPos, ref, sub }) => {
        // process the read features. this can be used similar to
        // CIGAR/MD strings in SAM. see CRAM specs for more details.
        if (code === 'X') {
          console.log(
            `${record.readName} shows a base substitution of ${ref}->${sub} at ${refPos}`,
          )
        }
      })
    }
  })
}

run()

// can also pass `cramUrl` (for the IndexedCramFile class), and `url` (for the CraiIndex) params to open remote URLs
// alternatively `cramFilehandle` (for the IndexedCramFile class) and `filehandle` (for the CraiIndex) can be used,  see for examples https://github.com/gmod/generic-filehandle
```

You can use cram-js without NPM also with the cram-bundle.js. See the example directory for usage with script tag

## API (auto-generated)

- [CramRecord](#cramrecord) - format of CRAM records returned by this API
  - [ReadFeatures](#readfeatures) - format of read features on records
- [IndexedCramFile](#indexedcramfile) - indexed access into a CRAM file
- [CramFile](#cramfile) - .cram API
- [CraiIndex](#craiindex) - .crai index API
- [Error Classes](#error-classes) - special error classes thrown by this API

### CramRecord

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

- [CramRecord](#cramrecord)
  - [Parameters](#parameters)
  - [isPaired](#ispaired)
  - [isProperlyPaired](#isproperlypaired)
  - [isSegmentUnmapped](#issegmentunmapped)
  - [isMateUnmapped](#ismateunmapped)
  - [isReverseComplemented](#isreversecomplemented)
  - [isMateReverseComplemented](#ismatereversecomplemented)
  - [isRead1](#isread1)
  - [isRead2](#isread2)
  - [isSecondary](#issecondary)
  - [isFailedQc](#isfailedqc)
  - [isDuplicate](#isduplicate)
  - [isSupplementary](#issupplementary)
  - [isDetached](#isdetached)
  - [hasMateDownStream](#hasmatedownstream)
  - [isPreservingQualityScores](#ispreservingqualityscores)
  - [isUnknownBases](#isunknownbases)
  - [getReadBases](#getreadbases)
  - [getPairOrientation](#getpairorientation)
  - [addReferenceSequence](#addreferencesequence)
    - [Parameters](#parameters-1)

#### CramRecord

Class of each CRAM record returned by this API.

##### Parameters

- `$0` **any**&#x20;

  - `$0.flags` &#x20;
  - `$0.cramFlags` &#x20;
  - `$0.readLength` &#x20;
  - `$0.mappingQuality` &#x20;
  - `$0.lengthOnRef` &#x20;
  - `$0.qualityScores` &#x20;
  - `$0.mateRecordNumber` &#x20;
  - `$0.readBases` &#x20;
  - `$0.readFeatures` &#x20;
  - `$0.mateToUse` &#x20;
  - `$0.readGroupId` &#x20;
  - `$0.readName` &#x20;
  - `$0.sequenceId` &#x20;
  - `$0.uniqueId` &#x20;
  - `$0.templateSize` &#x20;
  - `$0.alignmentStart` &#x20;
  - `$0.tags` &#x20;

##### isPaired

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read is paired, regardless of whether both segments are mapped

##### isProperlyPaired

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read is paired, and both segments are mapped

##### isSegmentUnmapped

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read itself is unmapped; conflictive with isProperlyPaired

##### isMateUnmapped

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read itself is unmapped; conflictive with isProperlyPaired

##### isReverseComplemented

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read is mapped to the reverse strand

##### isMateReverseComplemented

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the mate is mapped to the reverse strand

##### isRead1

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if this is read number 1 in a pair

##### isRead2

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if this is read number 2 in a pair

##### isSecondary

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if this is a secondary alignment

##### isFailedQc

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if this read has failed QC checks

##### isDuplicate

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read is an optical or PCR duplicate

##### isSupplementary

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if this is a supplementary alignment

##### isDetached

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read is detached

##### hasMateDownStream

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read has a mate in this same CRAM segment

##### isPreservingQualityScores

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read contains qual scores

##### isUnknownBases

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if the read has no sequence bases

##### getReadBases

Get the original sequence of this read.

Returns **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** sequence basepairs

##### getPairOrientation

Get the pair orientation of a paired read. Adapted from igv.js

Returns **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** of paired orientatin

##### addReferenceSequence

Annotates this feature with the given reference sequence basepair
information. This will add a `sub` and a `ref` item to base
substitution read features given the actual substituted and reference
base pairs, and will make the `getReadSequence()` method work.

###### Parameters

- `refRegion` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

  - `refRegion.start` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;
  - `refRegion.end` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;
  - `refRegion.seq` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)**&#x20;

- `compressionScheme` **CramContainerCompressionScheme**&#x20;

Returns **[undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined)** nothing

### ReadFeatures

The feature objects appearing in the `readFeatures` member of CramRecord objects that show insertions, deletions, substitutions, etc.

#### Static fields

- **code** (`character`): One of "bqBXIDiQNSPH". See page 15 of the CRAM v3 spec for their meanings.
- **data** (`any`): the data associated with the feature. The format of this varies depending on the feature code.
- **pos** (`number`): location relative to the read (1-based)
- **refPos** (`number`): location relative to the reference (1-based)

### IndexedCramFile

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

- [constructor](#constructor)
  - [Parameters](#parameters)
- [getRecordsForRange](#getrecordsforrange)
  - [Parameters](#parameters-1)
- [hasDataForReferenceSequence](#hasdataforreferencesequence)
  - [Parameters](#parameters-2)

#### constructor

##### Parameters

- `args` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

  - `args.cram` **CramFile**&#x20;
  - `args.index` **Index-like** object that supports getEntriesForRange(seqId,start,end) -> Promise\[Array\[index entries]]
  - `args.cacheSize` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** optional maximum number of CRAM records to cache. default 20,000
  - `args.fetchSizeLimit` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** optional maximum number of bytes to fetch in a single getRecordsForRange call. Default 3 MiB.
  - `args.checkSequenceMD5` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?** default true. if false, disables verifying the MD5
    checksum of the reference sequence underlying a slice. In some applications, this check can cause an inconvenient amount (many megabases) of sequences to be fetched.

#### getRecordsForRange

##### Parameters

- `seq` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** numeric ID of the reference sequence
- `start` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** start of the range of interest. 1-based closed coordinates.
- `end` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** end of the range of interest. 1-based closed coordinates.
- `opts` **{viewAsPairs: [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?, pairAcrossChr: [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?, maxInsertSize: [number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?}** (optional, default `{}`)

#### hasDataForReferenceSequence

##### Parameters

- `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** true if the CRAM file contains data for the given
reference sequence numerical ID

### CramFile

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

- [containerCount](#containercount)

#### containerCount

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<([number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number) | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))>**&#x20;

### CraiIndex

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

- [constructor](#constructor)
  - [Parameters](#parameters)
- [hasDataForReferenceSequence](#hasdataforreferencesequence)
  - [Parameters](#parameters-1)
- [getEntriesForRange](#getentriesforrange)
  - [Parameters](#parameters-2)

#### constructor

##### Parameters

- `args` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

  - `args.path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?**&#x20;
  - `args.url` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?**&#x20;
  - `args.filehandle` **FileHandle?**&#x20;

#### hasDataForReferenceSequence

##### Parameters

- `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** true if the index contains entries for
the given reference sequence ID, false otherwise

#### getEntriesForRange

fetch index entries for the given range

##### Parameters

- `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;
- `queryStart` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;
- `queryEnd` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** promise for
an array of objects of the form
`{start, span, containerStart, sliceStart, sliceBytes }`

### CramUnimplementedError

**Extends Error**

Error caused by encountering a part of the CRAM spec that has not yet been implemented

### CramMalformedError

**Extends CramError**

An error caused by malformed data.

### CramBufferOverrunError

**Extends CramMalformedError**

An error caused by attempting to read beyond the end of the defined data.

## Exception Classes

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic project that you publish, please cite the most recent JBrowse paper, which will be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
