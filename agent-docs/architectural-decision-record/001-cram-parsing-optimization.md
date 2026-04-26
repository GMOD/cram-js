# ADR 001: CRAM Parsing Optimization

**Status:** Decided — no action taken  
**Date:** 2026-04-26

## Context

Profiled two representative workloads to identify parsing bottlenecks:

- **SRR396637** (Illumina short reads): 54,695 records, 181ms p50, 301K
  records/sec
- **HG002** (ONT long reads): 37 records, 53ms p50, 701 records/sec

```
Short reads              Long reads
19.7%  GC               18.3%  decodeRecord
15.9%  decodeRecord      15.9%  wasm-function[61]
10.3%  wasm-function[61] 15.6%  GC
 7.9%  _fetchRecords     11.8%  decodeReadFeatures
 4.0%  decodeLatin1       8.0%  addReferenceSequence
```

GC dominates short reads (allocation pressure from ~55K records).
`decodeReadFeatures` dominates long reads (hundreds–thousands of
`{code, pos, refPos, data}` objects per read).

## Options Considered

**Lazy tag parsing**

Store raw codec bytes on the record; defer `parseTagData` calls until
`record.tags` is first accessed. The `decodeTags: false` infrastructure already
exists as a partial hint.

- API concern: `tags` is a plain writable public field. Converting to a getter
  is technically a breaking change (silent failure on assignment), though no
  known consumer mutates it.
- Actual access patterns in
  `jbrowse-components/plugins/alignments/src/CramAdapter`: `feature.get('tags')`
  is called for every record on every render to check the SA tag
  (`extractFeatureArrays.ts:69`) and the MM tag
  (`processFeatureAlignments.ts:194`). This forces a full tags parse for every
  record regardless of laziness — making whole-object laziness a no-op.
- Per-tag laziness (Proxy) could help but the spread
  `{ ...this.record.tags, RG }` in `CramSlightlyLazyFeature.ts:119` would
  materialize all values anyway, and Proxy overhead is non-trivial.

**Flat ReadFeature typed arrays**

Replace `ReadFeature[]` (array of objects) with parallel typed arrays
(`codes: Uint8Array`, `positions: Int32Array`, etc.) to eliminate per-feature
object allocation in long reads.

- `readFeatures?: ReadFeature[]` is a public field on the exported `CramRecord`.
  This is a breaking API change.

**WASM feature decode**

Move the `decodeReadFeatures` loop into WASM, outputting typed arrays directly.
No API surface change — WASM is an internal implementation detail. Would address
both the 11.8% `decodeReadFeatures` cost and a large fraction of the 15.6% GC in
long reads.

- High implementation effort: requires writing the decode loop in C, defining a
  typed-array ABI, and wiring into the existing codec infrastructure.
- No concrete performance complaint driving it.

**Bulk read name decode**

Decode all read names in a block with a single TextDecoder call rather than N
individual calls. No API change, low effort, ~3% potential savings for short
reads.

## Decision

**No optimizations pursued.**

Reasons:

- The short-read GC problem (19.7%) has no clean solution — it comes from
  allocating ~55K `CramRecord` objects per fetch, which is inherent to the
  workload. Object pooling would require callers to cooperate (signal when
  records can be released), a much larger API change than any of the above.
- Lazy tag parsing is moot because tags are accessed for every record in the
  render path (SA and MM checks).
- WASM feature decode is high effort with no concrete pain driving it.
- The primary consumer (JBrowse) is refactoring from an HTML5 canvas system that
  re-decoded on every frame to a WebGL/WebGPU pipeline. The new architecture
  amortizes parse cost across renders, substantially reducing the pressure that
  motivated this investigation.

## Revisit If

- A user reports a specific slow-load region (e.g. "loading this 50K-read window
  takes 3 seconds").
- Long-read ONT rendering becomes a more prominent use case.
- The WebGL/WebGPU refactor lands and a new profile reveals a different
  bottleneck.
