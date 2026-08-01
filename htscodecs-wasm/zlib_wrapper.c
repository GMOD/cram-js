/* Wrapper for libdeflate (gzip/zlib/raw-deflate decompression) */
#include "libdeflate.h"
#include <stdlib.h>
#include <string.h>

/*
 * libdeflate has no streaming API: every call decompresses in one bounded
 * pass and returns a result code. That rules out the class of bug the old
 * zlib-based wrapper had, where a truncated stream left inflate() making no
 * forward progress and the retry loop spun forever inside a synchronous
 * wasm call.
 */

/* Refuse to grow past this when the uncompressed size is unknown. */
#define MAX_ALLOC (1u << 31)

/* Highest expansion ratio a valid deflate stream can achieve. */
#define DEFLATE_MAX_RATIO 1032

/* One decompressor is reused across calls; it is a ~100KB heap struct and
 * the module is single-threaded. */
static struct libdeflate_decompressor *decompressor = NULL;

static struct libdeflate_decompressor *get_decompressor(void) {
    if (!decompressor) {
        decompressor = libdeflate_alloc_decompressor();
    }
    return decompressor;
}

enum format { FORMAT_GZIP, FORMAT_ZLIB, FORMAT_RAW };

static enum format sniff_format(const unsigned char *in, unsigned int in_size) {
    if (in_size >= 2 && in[0] == 0x1f && in[1] == 0x8b) {
        return FORMAT_GZIP;
    }
    /* zlib CMF byte: CM=8 for deflate */
    if (in_size >= 1 && (in[0] & 0x0F) == 0x08) {
        return FORMAT_ZLIB;
    }
    return FORMAT_RAW;
}

static enum libdeflate_result decompress_one(
    struct libdeflate_decompressor *d, enum format fmt,
    const unsigned char *in, size_t in_avail,
    unsigned char *out, size_t out_avail,
    size_t *in_used, size_t *out_used) {
    if (fmt == FORMAT_GZIP) {
        return libdeflate_gzip_decompress_ex(d, in, in_avail, out, out_avail,
                                             in_used, out_used);
    }
    if (fmt == FORMAT_ZLIB) {
        return libdeflate_zlib_decompress_ex(d, in, in_avail, out, out_avail,
                                             in_used, out_used);
    }
    return libdeflate_deflate_decompress_ex(d, in, in_avail, out, out_avail,
                                            in_used, out_used);
}

/*
 * Decompress `in` into a freshly malloc'd buffer, returning it and writing
 * its length to *out_size. Returns NULL on any malformed input.
 *
 * `expected_size` is the exact uncompressed size when the caller knows it
 * (CRAM block headers carry it), which lets us allocate once and skip the
 * grow loop entirely. Pass 0 when it is unknown.
 */
unsigned char *zlib_uncompress(unsigned char *in, unsigned int in_size,
                               unsigned int expected_size,
                               unsigned int *out_size) {
    if (in_size == 0) {
        *out_size = 0;
        return malloc(1);
    }

    struct libdeflate_decompressor *d = get_decompressor();
    if (!d) {
        return NULL;
    }

    const enum format fmt = sniff_format(in, in_size);

    /*
     * expected_size comes off the wire (a CRAM block header's ITF8), so it
     * cannot be trusted as an allocation size. deflate cannot expand by more
     * than 1032:1, so anything above that is a corrupt header; ignore it and
     * grow from the input size instead of mallocing on its word. Division
     * rather than multiplication so the bound itself cannot overflow.
     */
    if (expected_size / DEFLATE_MAX_RATIO > in_size) {
        expected_size = 0;
    }

    size_t alloc_size = expected_size;
    if (alloc_size == 0) {
        alloc_size = in_size * 4;
        if (alloc_size < 4096) {
            alloc_size = 4096;
        }
    }

    unsigned char *out = malloc(alloc_size);
    if (!out) {
        return NULL;
    }

    size_t in_pos = 0, out_pos = 0;
    while (1) {
        size_t in_used = 0, out_used = 0;
        const enum libdeflate_result res =
            decompress_one(d, fmt, in + in_pos, in_size - in_pos,
                           out + out_pos, alloc_size - out_pos,
                           &in_used, &out_used);

        if (res == LIBDEFLATE_INSUFFICIENT_SPACE) {
            /* Only reachable when expected_size was unknown or wrong. */
            if (alloc_size >= MAX_ALLOC) {
                free(out);
                return NULL;
            }
            size_t new_size = alloc_size * 2;
            if (new_size > MAX_ALLOC) {
                new_size = MAX_ALLOC;
            }
            unsigned char *new_out = realloc(out, new_size);
            if (!new_out) {
                free(out);
                return NULL;
            }
            out = new_out;
            alloc_size = new_size;
            continue;
        }

        /* A truncated or corrupt stream lands here and returns, rather than
         * looping. */
        if (res != LIBDEFLATE_SUCCESS) {
            free(out);
            return NULL;
        }

        in_pos += in_used;
        out_pos += out_used;

        /*
         * gzip members concatenate — BGZF (used for .crai indexes) is
         * exactly that, one member per ~64KB block. Keep going while the
         * next bytes still look like a member; anything else (the trailing
         * zero padding some writers emit) ends the stream.
         *
         * in_used is nonzero for any successful member, so in_pos always
         * advances and the loop terminates.
         */
        const int more = fmt == FORMAT_GZIP && in_used > 0 &&
                         in_size - in_pos >= 2 && in[in_pos] == 0x1f &&
                         in[in_pos + 1] == 0x8b;
        if (!more) {
            break;
        }
    }

    *out_size = out_pos;
    return out;
}
