class CramError extends Error {}

/** Error caused by encountering a part of the CRAM spec that has not yet been implemented */
class CramUnimplementedError extends Error {}

/** An error caused by malformed data.  */
class CramMalformedError extends CramError {}

/** An error caused by attempting to read beyond the end of the defined data. */
class CramBufferOverrunError extends CramMalformedError {}

module.exports = {
  CramBufferOverrunError,
  CramMalformedError,
  CramUnimplementedError,
}
