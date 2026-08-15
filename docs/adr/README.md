# Architecture decision records

Decisions that shape how the decoder fits together, with the evidence that
settled them and the consequences that came with them.

How this differs from the other documents here:

- **`docs/adr/`** — a decision we took, why, and what it costs. Written once,
  then amended only to supersede it.
- **[`TODO.md`](../../TODO.md)** — work we measured, still open, and that we
  want to do. Facts and measurements, not decisions; an item leaves the file
  when it lands. Something measured and deliberately rejected _is_ a decision,
  so it lives here, in [0007](0007-optimizations-measured-and-rejected.md).
- **[`optimizations.md`](../optimizations.md)** — the query path in one pass,
  with a line and a number for each decision and a link to the ADR that settled
  it. Start here; the ADRs are the long form.
- **[`api.md`](../api.md)**, **[`memory.md`](../memory.md)**,
  **[`read-features.md`](../read-features.md)**, **[`wasm.md`](../wasm.md)**,
  **[`workers.md`](../workers.md)**,
  **[`codec-support.md`](../codec-support.md)** — how a part of the library
  works today, for someone using or changing it.

| #                                                       | decision                                                       | status   |
| ------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-codec-binding-seam.md)                      | Codecs bind their own per-slice fast paths                     | accepted |
| [0002](0002-batch-decoding-over-lazy-fields.md)         | Batch per-record work rather than defer it behind a getter     | accepted |
| [0003](0003-abortsignal-on-the-read-path.md)            | Cancel per-query reads, reference-count the shared ones        | accepted |
| [0004](0004-size-the-slice-cache-above-one-query.md)    | Size the slice cache above one query, and reclaim it when idle | accepted |
| [0005](0005-drop-the-batch-eviction-policy.md)          | Drop the `'batch'` eviction policy                             | accepted |
| [0006](0006-cigar-as-a-callback-walk.md)                | Walk the CIGAR with a callback, not an array                   | accepted |
| [0007](0007-optimizations-measured-and-rejected.md)     | Optimizations measured and rejected                            | accepted |
| [0008](0008-emit-into-the-consumers-callback.md)        | Emit into the consumer's callback, not into a translator       | accepted |
| [0009](0009-one-pool-per-context-sized-for-the-host.md) | One slice pool per JS context, sized by the host               | accepted |
| [0010](0010-checkpoint-the-payload-offsets.md)          | Checkpoint the payload offsets, one per eight slots            | accepted |

## Writing one

Number sequentially, and keep the four headings: **Context**, **Decision**,
**Consequences**, **Evidence**.

The evidence section is not optional. A decision recorded without the
measurement that settled it is an opinion — and this codebase has already had
one 3% "win" survive six rounds of benchmarking before disappearing under
fourteen. See the method note at the end of `TODO.md` for how to A/B this repo
without fooling yourself.
