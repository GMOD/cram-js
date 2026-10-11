# Reading over HTTP

Pass `cramUrl` and `CraiIndex({ url })` to read a remote file:

```js
const indexedFile = new IndexedCramFile({
  cramUrl: 'https://example.com/file.cram',
  index: new CraiIndex({ url: 'https://example.com/file.cram.crai' }),
})
```

An indexed query reads one byte range per slice and two small ones per
container, so a whole-reference query on a 141 KB test file makes 202 reads. The
`RemoteFile` that `cramUrl` creates sends a separate range request for each
read.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
serves the reads from 256 KiB chunks, so neighboring reads share a request and
the 202 reads become a handful of requests:

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const indexedFile = new IndexedCramFile({
  cramFilehandle: new RemoteFileWithRangeCache(url),
  index: new CraiIndex({
    filehandle: new RemoteFileWithRangeCache(`${url}.crai`),
  }),
})
```

The cache also passes the query's `AbortSignal` to `fetch`, so cancelling a
query cancels its network requests, as [api.md](api.md#cancelling-a-query)
describes.
