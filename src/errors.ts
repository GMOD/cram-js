/**
 * Base class of every error this library raises on its own account. Catching
 * this separates "the file, or how it was asked for, is the problem" from a
 * network or filehandle failure, which arrives as whatever the filehandle threw.
 *
 * All of these are re-exported from the package entry point, which is the only
 * way a consumer can reach them: `package.json`'s `exports` map has no subpaths,
 * so a deep import into `esm/errors.js` is blocked.
 */
export class CramError extends Error {}

/**
 * Error caused by encountering a part of the CRAM spec that has not yet been
 * implemented.
 */
export class CramUnimplementedError extends CramError {}

/** An error caused by malformed data.  */
export class CramMalformedError extends CramError {}

/**
 * An invalid argument was supplied to a cram-js method or object.
 */
export class CramArgumentError extends CramError {}

/** Read past the end of a block, indicating a truncated file. */
export class CramBufferOverrunError extends CramError {
  readonly code = 'CRAM_BUFFER_OVERRUN' as const
}
