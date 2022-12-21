# v1.7.3

- Fix usage of the 'b' tag under situations in CRA4 where a Uint8Array is
  received instead of Buffer

# v1.7.2

- Update README.md with docs

# v1.7.1

- Re-export CramRecord class for typescript

# v1.7.0

- Typescript entire codebase, big thanks to @0xorial for taking on this effort!
- Update to use webpack 5 for UMD build

# v1.6.4

- Fix off by one in returning features from getRecordsFromRange

# v1.6.3

- Optimize CRAM parsing slightly (15% improvement on many short reads). This removes support for big endian machines
- Publish src directory for sourceMap

# v1.6.2

- Publish src directory for better source maps

# v1.6.1

- Explicitly use pako for browser bundle to help avoid buggy zlib polyfills

# v1.6.0

- Support CRAMv3.1 (thanks to @jkbonfield for contributing!)
- Support bzip codec
- Remove localFile from the browser bundle using "browser" package.json field
- Add esm module field in package.json

# v1.5.9

- Fix CRAM not downloading proper records for long reads (pt2, PR #84)

# v1.5.8

- Fix CRAM not downloading proper records for long reads (pt1, PR #85)

# v1.5.7

- Add getHeaderText to CRAM to get SAM header

# v1.5.6

- Remove unnecessary rethor win tinyMemoize error handler
- Avoid uncaught promise from constructor

# v1.5.5

- Fix ability to reload CRAM file after failure
- Check if BAI file incorrectly submitted as index for CRAM

# v1.5.4

- Fix handling of hard clipping

# v1.5.3

- Improved README
- Upgrade to babel 7
- Upgrade @gmod/binary-parser
- Add fix for 'b', 'q', and 'Q' readFeatures

# v1.5.2

- Fix off-by-one error in range query
- Add webpack cram-bundle.js

# v1.5.1

- Add fix for when mate is unmapped

# v1.5.0

- Add lossy-names support
- Fix for mate strand

# v1.4.3

- Make sure mate exists for unmated pair, can exist when coordinate slices of cram file are made via samtools view

# v1.4.2

- Switch to es6-promisify for ie11
- Switch to quick-lru instead of lru-cache for ie11

# v1.4.1

- Add maxInsertSize for viewAsPairs

# v1.4.0

- Add viewAsPairs implementation

# v1.3.0

- Fix tests in node 6
- Make cram record unique IDs start at 1 instead of 0 to always be truthy
- Implement gamma and subexp codecs

# v1.2.0

- Add `getReadBases` docs
- Rewrite seq calculation to be much faster
- Implement ref fetching for multi-ref slices
