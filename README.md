# @gmod/cram

[![Generated with nod](https://img.shields.io/badge/generator-nod-2196F3.svg?style=flat-square)](https://github.com/diegohaz/nod)
[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
[![Build Status](https://img.shields.io/travis/GMOD/cram-js/master.svg?style=flat-square)](https://travis-ci.org/GMOD/cram-js) [![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/cram-js/master.svg?style=flat-square)](https://codecov.io/gh/GMOD/cram-js/branch/master) [![Greenkeeper badge](https://badges.greenkeeper.io/GMOD/cram-js.svg)](https://greenkeeper.io/)

Read CRAM files (indexed or unindexed) with pure JS, works in node or in the browser.

-   Reads CRAM 3.x and 2.x
-   Does not read CRAM 1.x
-   Can use .crai indexes out of the box, for efficient sequence fetching, but also has an [index API](#craiindex) that would allow use with other index types
-   Does not implement bzip2 or lzma codecs (yet), as these are rarely used in-the-wild; if this is important to your use case, please file an issue

## Install

```bash
$ npm install --save @gmod/cram
# or
$ yarn add @gmod/cram
```

## Usage

```js
const { IndexedCramFile, CramFile, CraiIndex } = require('@gmod/cram')

//Use indexedfasta library for seqFetch, if using local file (see below)
const { IndexedFasta, BgzipIndexedFasta } = require('@gmod/indexedfasta')


const t = new IndexedFasta({
  path: '/filesystem/yourfile.fa',
  faiPath: '/filesystem/yourfile.fa.fai',
});


// open local files
const indexedFile = new IndexedCramFile({
  cramPath: '/filesystem/yourfile.cram',
  index: new CraiIndex({
    path: '/filesystem/yourfile.cram.crai'),
  }),
  seqFetch: async (seqId, start, end) => {
    // note:
    // * seqFetch should return a promise for a string, in this instance retrieved from IndexedFasta
    // * we use start-1 because cram-js uses 1-based but IndexedFasta uses 0-based coordinates
    // * the seqId is a numeric identifier
    return t.getSequence(seqId, start-1, end)
    }
  },
  checkSequenceMD5: false,
})

// example of fetching records from an indexed CRAM file.
// NOTE: only numeric IDs for the reference sequence are accepted.
// For indexedfasta the numeric ID is the order in which the sequence names appear in the header

// Wrap in an async and then run
run = async() => {
  const records = await indexedFile.getRecordsForRange(0, 10000, 20000)
  records.forEach(record => {
    console.log(`got a record named ${record.readName}`)
    record.readFeatures.forEach(({ code, pos, refPos, ref, sub }) => {
      // process the "read features". this can be used similar to
      // CIGAR/MD strings in SAM. see CRAM specs for more details.
      if (code === 'X')
        console.log(
          `${
            record.readName
          } shows a base substitution of ${ref}->${sub} at ${refPos}`,
        )
    })
  })
}

run()


// can also pass `cramUrl` (for the IndexedCramFile class), and `url` (for the CraiIndex) params to open remote URLs
// alternatively `cramFilehandle` (for the IndexedCramFile class) and `filehandle` (for the CraiIndex) can be used,  see for examples https://github.com/gmod/generic-filehandle
```

## API (auto-generated)

-   [CramRecord](#cramrecord) - format of CRAM records returned by this API
     - [ReadFeatures](#readfeatures) - format of read features on records
-   [IndexedCramFile](#indexedcramfile) - indexed access into a CRAM file
-   [CramFile](#cramfile) - .cram API
-   [CraiIndex](#craiindex) - .crai index API
-   [Error Classes](#error-classes) - special error classes thrown by this API

### CramRecord

These are the record objects returned by this API. Much of the data
is stored in them as simple object entries, but there are some accessor
methods used for conveniently getting the values of each of the flags in
the `flags` and `cramFlags` fields.

#### Static fields

- **flags** (`number`): the SAM bit-flags field, see the SAM spec for interpretation. Some of the `is*` methods below interpret this field.
- **cramFlags** (`number`): the CRAM-specific bit-flags field, see the CRAM spec for interpretation. Some of the `is*` methods below interpret this field.
- **sequenceId** (`number`): the ID number of the record's reference sequence
- **readLength** (`number`): length of the read in bases
- **alignmentStart** (`number`): start coordinate of the alignment on the reference in 1-based closed coordinates
- **readGroupId** (`number`): ID number of the read group, or -1 if none
- **readName** (`number`): name of the read (string)
- **templateSize** (`number`): for paired sequencing, the total size of the template
- **readFeatures** (`array[ReadFeature]`): array of read features showing insertions, deletions, mismatches, etc. See [ReadFeatures](#readfeatures) for their format.
- **lengthOnRef** (`number`): span of the alignment along the reference sequence
- **mappingQuality** (`number`): SAM mapping quality
- **qualityScores** (`array[number]`): array of numeric quality scores
- **uniqueId** (`number`): unique ID number of the record within the file
- **mate** (`object`)
  - **flags** (`number`): CRAM mapping flags for the mate. See CRAM spec for interpretation. Some of the `is*` methods below interpret this field.
  - **sequenceId** (`number`): reference sequence ID for the mate mapping
  - **alignmentStart** (`number`): start coordinate of the mate mapping. 1-based coordinates.

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Methods

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

##### addReferenceSequence

Annotates this feature with the given reference sequence basepair
information. This will add a `sub` and a `ref` item to base
subsitution read features given the actual substituted and reference
base pairs, and will make the `getReadSequence()` method work.

**Parameters**

-   `refRegion` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
    -   `refRegion.start` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 
    -   `refRegion.end` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 
    -   `refRegion.seq` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
-   `compressionScheme` **CramContainerCompressionScheme** 

Returns **[undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined)** nothing

### ReadFeatures

The feature objects appearing in the `readFeatures` member of CramRecord objects that show insertions, deletions, substitutions, etc.

#### Static fields

- **code** (`character`): One of "bqBXIDiQNSPH". See page 15 of the CRAM v3 spec for their meanings.
- **data** (`any`): the data associated with the feature. The format of this varies depending on the feature code.
- **pos** (`number`): location relative to the read (1-based)
- **refPos** (`number`): location relative to the reference (1-based)

### IndexedCramFile

The pairing of an index and a CramFile. Supports efficient fetching of records for sections of reference sequences.

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

-   [constructor](#constructor)
-   [getRecordsForRange](#getrecordsforrange)
-   [hasDataForReferenceSequence](#hasdataforreferencesequence)

#### constructor

**Parameters**

-   `args` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
    -   `args.cram` **CramFile** 
    -   `args.index` **Index-like** object that supports getEntriesForRange(seqId,start,end) -> Promise\[Array[index entries]]
    -   `args.cacheSize` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** optional maximum number of CRAM records to cache.  default 20,000
    -   `args.fetchSizeLimit` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** optional maximum number of bytes to fetch in a single getRecordsForRange call.  Default 3 MiB.
    -   `args.checkSequenceMD5` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?** default true. if false, disables verifying the MD5
        checksum of the reference sequence underlying a slice. In some applications, this check can cause an inconvenient amount (many megabases) of sequences to be fetched.

#### getRecordsForRange

**Parameters**

-   `seq` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** numeric ID of the reference sequence
-   `start` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** start of the range of interest. 1-based closed coordinates.
-   `end` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** end of the range of interest. 1-based closed coordinates.

#### hasDataForReferenceSequence

**Parameters**

-   `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** true if the CRAM file contains data for the given
reference sequence numerical ID

### CramFile

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

-   [constructor](#constructor)
-   [containerCount](#containercount)

#### constructor

**Parameters**

-   `args` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
    -   `args.filehandle` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** a filehandle that implements the stat() and
        read() methods of the Node filehandle API <https://nodejs.org/api/fs.html#fs_class_filehandle>
    -   `args.path` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** path to the cram file
    -   `args.url` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** url for the cram file.  also supports file:// urls for local files
    -   `args.seqFetch` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)?** a function with signature
        `(seqId, startCoordinate, endCoordinate)` that returns a promise for a string of sequence bases
    -   `args.cacheSize` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** optional maximum number of CRAM records to cache.  default 20,000
    -   `args.checkSequenceMD5` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?** default true. if false, disables verifying the MD5
        checksum of the reference sequence underlying a slice. In some applications, this check can cause an inconvenient amount (many megabases) of sequences to be fetched.

#### containerCount

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** the number of containers in the file

### CraiIndex

Represents a .crai index.

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

-   [constructor](#constructor)
-   [hasDataForReferenceSequence](#hasdataforreferencesequence)
-   [getEntriesForRange](#getentriesforrange)

#### constructor

**Parameters**

-   `args` **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
    -   `args.path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?** 
    -   `args.url` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?** 
    -   `args.filehandle` **FileHandle?** 

#### hasDataForReferenceSequence

**Parameters**

-   `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** true if the index contains entries for
the given reference sequence ID, false otherwise

#### getEntriesForRange

fetch index entries for the given range

**Parameters**

-   `seqId` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 
-   `queryStart` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 
-   `queryEnd` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** promise for
an array of objects of the form
`{start, span, containerStart, sliceStart, sliceBytes }`

#### Error Classes

`@gmod/cram/errors` contains some special error classes thrown by cram-js. A list of the error classes is below.

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

-   [CramUnimplementedError](#cramunimplementederror)
-   [CramMalformedError](#crammalformederror)
-   [CramBufferOverrunError](#crambufferoverrunerror)
-   [CramSizeLimitError](#cramsizelimiterror)
-   [CramArgumentError](#cramargumenterror)

#### CramUnimplementedError

**Extends Error**

Error caused by encountering a part of the CRAM spec that has not yet been implemented

#### CramMalformedError

**Extends CramError**

An error caused by malformed data.

#### CramBufferOverrunError

**Extends CramMalformedError**

An error caused by attempting to read beyond the end of the defined data.

#### CramSizeLimitError

**Extends CramError**

An error caused by data being too big, exceeding a size limit.

#### CramArgumentError

**Extends CramError**

An invalid argument was supplied to a cram-js method or object.

### CramUnimplementedError

**Extends Error**

Error caused by encountering a part of the CRAM spec that has not yet been implemented

### CramMalformedError

**Extends CramError**

An error caused by malformed data.

### CramBufferOverrunError

**Extends CramMalformedError**

An error caused by attempting to read beyond the end of the defined data.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic project that you publish, please cite the most recent JBrowse paper, which will be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
