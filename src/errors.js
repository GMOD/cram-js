class CramError extends Error {}

/** Error caused by encountering a part of the CRAM spec that has not yet been implemented */
class CramUnimplementedError extends Error {}

/** An error caused by malformed data.  */
class CramMalformedError extends CramError {}

/**
 * An error caused by attempting to read beyond the end of the defined data.
 */
class CramBufferOverrunError extends CramMalformedError {}


/**
 * An error caused by data being too big, exceeding a size limit.
 */
class CramSizeLimitError extends CramError {}

/**
 * An invalid argument was supplied to a cram-js method or object.
 */
class CramArgumentError extends CramError {}

module.exports = {
  CramBufferOverrunError,
  CramMalformedError,
  CramUnimplementedError,
  CramSizeLimitError,
  CramArgumentError,
}
