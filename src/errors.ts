/**
 * Base class of every error this library raises on its own account. Catching
 * this separates "the file, or how it was asked for, is the problem" from a
 * network or filehandle failure, which arrives as whatever the filehandle threw.
 *
 * All of these are exported from the package entry point. They were not until
 * 13.3.0 — and since `package.json`'s `exports` map has no subpaths, a deep
 * import could not reach them either, so `instanceof CramMalformedError` was
 * simply not available to a consumer however the docs described it.
 */
export class CramError extends Error {}

/**
 * Error caused by encountering a part of the CRAM spec that has not yet been
 * implemented.
 *
 * Extends {@link CramError} like the rest. It extended `Error` directly until
 * 13.3.0, which made it the one error in this file that a `catch (e) { if (e
 * instanceof CramError) }` silently missed.
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
