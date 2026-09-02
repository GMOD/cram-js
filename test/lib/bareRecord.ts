import CramRecord, { NEXT_UNKNOWN } from '../../src/cramFile/record.ts'
import TagColumn from '../../src/cramFile/tagColumn.ts'

import type { CramRecordArgs } from '../../src/cramFile/record.ts'

/** a record carrying just the fields a test cares about, the rest defaulted */
export function bareRecord(fields: Partial<CramRecordArgs>) {
  return new CramRecord({
    flags: 0,
    cramFlags: 0,
    readLength: 0,
    start: 0,
    sequenceId: 0,
    readGroupId: 0,
    uniqueId: 0,
    nextSequenceId: NEXT_UNKNOWN,
    nextStart: -1,
    qualityStart: -1,
    readFeatureStart: 0,
    readFeatureCount: 0,
    tagColumn: new TagColumn(),
    tagStart: 0,
    tagCount: 0,
    ...fields,
  })
}
