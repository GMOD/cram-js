# Architecture decision records

Decisions that shape how the decoder is put together, with the evidence that
settled them and the consequences that came with them.

The distinction from the other documents here:

- **`docs/adr/`** — a decision that was taken, why, and what it costs. Written
  once, then amended only to supersede it.
- **[`TODO.md`](../../TODO.md)** — work investigated and measured but _not_
  done, including things deliberately rejected. Facts and measurements, not
  decisions.
- **[`docs/MEMORY.md`](../MEMORY.md)**,
  **[`docs/READ_FEATURES.md`](../READ_FEATURES.md)**,
  **[`docs/WASM.md`](../WASM.md)**,
  **[`docs/CODEC_SUPPORT.md`](../CODEC_SUPPORT.md)** — how a part of the library
  works today, for someone using or changing it.

| #                                               | decision                                                   | status   |
| ----------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-codec-binding-seam.md)              | Codecs bind their own per-slice fast paths                 | accepted |
| [0002](0002-batch-decoding-over-lazy-fields.md) | Batch per-record work rather than defer it behind a getter | accepted |

## Writing one

Number sequentially, and keep the four headings: **Context**, **Decision**,
**Consequences**, **Evidence**. The evidence section is not optional — a
decision recorded without the measurement that settled it is an opinion, and
this codebase has already had one 3% "win" survive six rounds of benchmarking
before disappearing under fourteen (see the note at the end of `TODO.md` on how
to A/B this repo without fooling yourself).
