import { CramMalformedError } from '../../errors.ts'
import Constants from '../constants.ts'

import type CramRecord from '../record.ts'

/**
 * Try to estimate the template length from a bunch of interrelated
 * multi-segment reads.
 */
function calculateMultiSegmentMatedTemplateLength(
  allRecords: CramRecord[],
  thisRecord: CramRecord,
) {
  const matedRecords: CramRecord[] = [thisRecord]
  let cur = thisRecord
  while (cur.mateRecordNumber !== undefined && cur.mateRecordNumber >= 0) {
    const mateRecord = allRecords[cur.mateRecordNumber]
    if (!mateRecord) {
      throw new CramMalformedError(
        'intra-slice mate record not found, this file seems malformed',
      )
    }
    // A well-formed NF is a forward offset (`NF + recordNumber + 1`), so the
    // chain strictly increases and cannot revisit a record. A malformed one
    // points backwards and the walk never terminates: it re-pushes the same
    // records until the process dies — 14 million entries in two seconds, and
    // synchronously, so the tab cannot even be interrupted. Every record is
    // visited at most once, so overrunning the slice means a cycle.
    if (matedRecords.length > allRecords.length) {
      throw new CramMalformedError(
        'cyclic intra-slice mate chain, this file seems malformed',
      )
    }
    matedRecords.push(mateRecord)
    cur = mateRecord
  }

  let minStart = matedRecords[0]!.start
  let maxEnd = minStart + matedRecords[0]!.readLength
  for (let i = 1; i < matedRecords.length; i++) {
    const r = matedRecords[i]!
    if (r.start < minStart) {
      minStart = r.start
    }
    const end = r.start + r.readLength
    if (end > maxEnd) {
      maxEnd = end
    }
  }
  const estimatedTemplateLength = maxEnd - minStart
  if (estimatedTemplateLength >= 0) {
    matedRecords.forEach(r => {
      if (r.templateLength !== undefined) {
        throw new CramMalformedError(
          'mate pair group has some members that have template lengths already, this file seems malformed',
        )
      }
      // sign per SAM spec: positive for leftmost, negative for rightmost
      r.templateLength =
        r.start === minStart
          ? estimatedTemplateLength
          : -estimatedTemplateLength
    })
  }
}

/**
 * Attempt to calculate the `templateLength` for a pair of intra-slice paired
 * reads. Ported from htslib. Algorithm is imperfect.
 */
function calculateIntraSliceMatePairTemplateLength(
  thisRecord: CramRecord,
  mateRecord: CramRecord,
) {
  // this just estimates the template length by using the simple (non-gapped)
  // end coordinate of each read, because gapping in the alignment doesn't mean
  // the template is longer or shorter
  const start = Math.min(thisRecord.start, mateRecord.start)
  const end = Math.max(
    thisRecord.start + thisRecord.readLength,
    mateRecord.start + mateRecord.readLength,
  )
  const lengthEstimate = end - start
  // sign per SAM spec: positive for leftmost, negative for rightmost
  thisRecord.templateLength =
    thisRecord.start <= mateRecord.start ? lengthEstimate : -lengthEstimate
  mateRecord.templateLength =
    mateRecord.start <= thisRecord.start ? lengthEstimate : -lengthEstimate
}

/**
 * establishes a mate-pair relationship between two records in the same slice.
 * CRAM compresses mate-pair relationships between records in the same slice
 * down into just one record having the index in the slice of its mate
 */
function associateIntraSliceMate(
  allRecords: CramRecord[],
  currentRecordNumber: number,
  thisRecord: CramRecord,
  mateRecord: CramRecord,
) {
  const complicatedMultiSegment =
    mateRecord.hasNextPosition() ||
    (mateRecord.mateRecordNumber !== undefined &&
      mateRecord.mateRecordNumber !== currentRecordNumber)

  // Lossy read names: the encoder drops the name of a mate group that fits in
  // one slice, so give the group one back, named after the record the ascending
  // walk reaches first — as htslib names it (cram_decode.c). Read that name off
  // `thisRecord` rather than testing it, which is what carries it past the
  // second segment; a `!thisRecord.readName` guard left the far end of a
  // three-segment chain unnamed. ADR 0011.
  const groupName = thisRecord.readName ?? String(thisRecord.uniqueId)
  thisRecord.setSyntheticReadName(groupName)
  mateRecord.setSyntheticReadName(groupName)

  thisRecord.nextSequenceId = mateRecord.sequenceId
  thisRecord.nextStart = mateRecord.start

  // the mate record might have its own mate pointer, if this is some kind of
  // multi-segment (more than paired) scheme, so only relate that one back to this one
  // if it does not have any other relationship
  if (
    !mateRecord.hasNextPosition() &&
    mateRecord.mateRecordNumber === undefined
  ) {
    mateRecord.nextSequenceId = thisRecord.sequenceId
    mateRecord.nextStart = thisRecord.start
  }

  // make sure the proper flags and cramFlags are set on both records
  // paired
  thisRecord.flags |= Constants.BAM_FPAIRED

  // set mate unmapped if needed
  if (mateRecord.flags & Constants.BAM_FUNMAP) {
    thisRecord.flags |= Constants.BAM_FMUNMAP
  }
  if (thisRecord.flags & Constants.BAM_FUNMAP) {
    mateRecord.flags |= Constants.BAM_FMUNMAP
  }

  // set mate reversed if needed
  if (mateRecord.flags & Constants.BAM_FREVERSE) {
    thisRecord.flags |= Constants.BAM_FMREVERSE
  }
  if (thisRecord.flags & Constants.BAM_FREVERSE) {
    mateRecord.flags |= Constants.BAM_FMREVERSE
  }

  if (thisRecord.templateLength === undefined) {
    if (complicatedMultiSegment) {
      calculateMultiSegmentMatedTemplateLength(allRecords, thisRecord)
    } else {
      calculateIntraSliceMatePairTemplateLength(thisRecord, mateRecord)
    }
  }

  // delete this last because it's used by the
  // complicated template length estimation
  thisRecord.mateRecordNumber = undefined
}

/**
 * Interpret the `recordsToNextFragment` attributes the decode left behind,
 * filling in each record's `nextSequenceId`/`nextStart` from its in-slice mate.
 *
 * The decode loop fills every slot or throws, so `records[i]` is always
 * defined here; the `records[mateRecordNumber]` guard is against a malformed
 * pointer past the end of the slice.
 *
 * Exported for the tests that pin its behaviour on malformed mate pointers;
 * nothing outside the decode calls it.
 */
export function associateIntraSliceMates(records: CramRecord[]) {
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i]!
    const { mateRecordNumber } = r
    if (
      mateRecordNumber !== undefined &&
      mateRecordNumber >= 0 &&
      records[mateRecordNumber]
    ) {
      associateIntraSliceMate(records, i, r, records[mateRecordNumber])
    }
  }
}
