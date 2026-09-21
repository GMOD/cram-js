import { CramMalformedError } from '../../errors.ts'
import Constants from '../constants.ts'

import type CramRecord from '../record.ts'

/**
 * Set `templateLength` on every record of the mate chain starting at `head`,
 * and close the chain into a circle by pointing its last record back at
 * `head`, as htslib's `cram_decode_slice_xref` does.
 *
 * The span runs from the leftmost start to the rightmost end on the reference,
 * `record.end` being htslib's `aend`. The head takes the sign: positive when it
 * is leftmost and not also rightmost, with READ1 breaking a tie between mates
 * at identical coordinates; every other record takes the opposite sign. A chain
 * crossing references gets 0.
 */
function resolveTemplateLength(
  records: CramRecord[],
  mateLine: Int32Array,
  head: number,
) {
  const first = records[head]!
  let left = first.start
  let right = first.end
  let leftCount = 0
  let rightCount = 0
  let sameReference = true
  let id = head
  for (;;) {
    const r = records[id]!
    if (r.start < left) {
      left = r.start
      leftCount = 1
    } else if (r.start === left) {
      leftCount++
    }
    if (r.end > right) {
      right = r.end
      rightCount = 1
    } else if (r.end === right) {
      rightCount++
    }
    const next = mateLine[id]!
    if (next === -1) {
      mateLine[id] = head
      break
    }
    // NF is a forward offset, so a pointer that goes back or stays put is a
    // cycle, and one past the end leads nowhere
    if (next <= id || next >= records.length) {
      throw new CramMalformedError(
        'cyclic or out-of-range intra-slice mate chain, this file seems malformed',
      )
    }
    id = next
    if (records[id]!.sequenceId !== first.sequenceId) {
      sameReference = false
    }
  }

  let headLength = 0
  let restLength = 0
  if (sameReference) {
    const span = right - left
    const headIsLeft = first.start === left
    if (headIsLeft && (first.end < right || leftCount <= 1)) {
      headLength = span
      restLength = -span
    } else if (
      headIsLeft &&
      first.end === right &&
      leftCount > 1 &&
      rightCount > 1
    ) {
      const isRead1 = !!(first.flags & Constants.BAM_FREAD1)
      headLength = isRead1 ? span : -span
      restLength = isRead1 ? -span : span
    } else {
      headLength = -span
      restLength = span
    }
  }
  first.templateLength = headLength
  for (let i = mateLine[head]!; i !== head; i = mateLine[i]!) {
    records[i]!.templateLength = restLength
  }
}

/**
 * Resolve the intra-slice mate links the decode left behind as
 * `mateRecordNumber`, porting htslib's `cram_decode_slice_xref`: each record in
 * a chain takes its next segment's position and strand, the last one's being
 * the first, and gets a computed `templateLength` — 0 where the record or its
 * mate is unmapped.
 *
 * A lossy-named file stores no name for such a chain, so each link also hands
 * the name of the record holding the pointer to its mate, falling back to that
 * record's uniqueId — how htslib names the group too (ADR 0011).
 *
 * Exported for the tests that pin its behaviour on malformed mate pointers;
 * nothing outside the decode calls it.
 */
export function associateIntraSliceMates(records: CramRecord[]) {
  const n = records.length
  const mateLine = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const mate = records[i]!.mateRecordNumber
    if (mate !== undefined && mate >= 0) {
      mateLine[i] = mate
    }
  }

  for (let i = 0; i < n; i++) {
    const mateIndex = mateLine[i]!
    if (mateIndex < 0 || mateIndex >= n) {
      continue
    }
    const r = records[i]!
    if (mateIndex > i) {
      const groupName = r.readName ?? String(r.uniqueId)
      r.setSyntheticReadName(groupName)
      records[mateIndex]!.setSyntheticReadName(groupName)
    }
    if (r.templateLength === undefined) {
      resolveTemplateLength(records, mateLine, i)
    }

    const mate = records[mateLine[i]!]!
    r.nextSequenceId = mate.sequenceId
    r.nextStart = mate.start
    let flags = r.flags | Constants.BAM_FPAIRED
    if (mate.flags & Constants.BAM_FUNMAP) {
      flags |= Constants.BAM_FMUNMAP
      r.templateLength = 0
    }
    if (r.flags & Constants.BAM_FUNMAP) {
      r.templateLength = 0
    }
    if (mate.flags & Constants.BAM_FREVERSE) {
      flags |= Constants.BAM_FMREVERSE
    }
    r.flags = flags
    r.mateRecordNumber = undefined
  }
}
