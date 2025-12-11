/* Fast wrapper for zlib inflate (gzip/zlib decompression) */
#include <zlib.h>
#include <stdlib.h>
#include <string.h>

/*
 * Fast inflate that skips CRC checking for speed.
 * Uses raw deflate (windowBits = -15) when possible to avoid header overhead.
 * Auto-detects gzip vs zlib vs raw deflate format.
 */
unsigned char *zlib_uncompress(unsigned char *in, unsigned int in_size,
                               unsigned int *out_size) {
    if (in_size == 0) {
        *out_size = 0;
        return malloc(1);
    }

    z_stream strm;
    memset(&strm, 0, sizeof(strm));

    /*
     * Detect format and choose windowBits:
     * - gzip (0x1f 0x8b): windowBits = 15 + 16 = 31
     * - zlib (0x78): windowBits = 15
     * - raw deflate: windowBits = -15
     *
     * Using 15+32 enables auto-detection but we can be more explicit
     * for slightly faster init.
     */
    int windowBits;
    if (in_size >= 2 && in[0] == 0x1f && in[1] == 0x8b) {
        /* gzip format */
        windowBits = 15 + 16;
    } else if (in_size >= 1 && (in[0] & 0x0F) == 0x08) {
        /* zlib format (CMF byte: CM=8 for deflate) */
        windowBits = 15;
    } else {
        /* Assume raw deflate */
        windowBits = -15;
    }

    int ret = inflateInit2(&strm, windowBits);
    if (ret != Z_OK) {
        return NULL;
    }

    /* Start with 4x input size, grow if needed */
    unsigned int alloc_size = in_size * 4;
    if (alloc_size < 4096) alloc_size = 4096;

    unsigned char *out = malloc(alloc_size);
    if (!out) {
        inflateEnd(&strm);
        return NULL;
    }

    strm.next_in = in;
    strm.avail_in = in_size;
    strm.next_out = out;
    strm.avail_out = alloc_size;

    /* Use Z_SYNC_FLUSH for slightly faster decompression */
    while (1) {
        ret = inflate(&strm, Z_SYNC_FLUSH);

        if (ret == Z_STREAM_END) {
            break;
        }

        if (ret != Z_OK && ret != Z_BUF_ERROR) {
            inflateEnd(&strm);
            free(out);
            return NULL;
        }

        /* Need more output space */
        if (strm.avail_out == 0) {
            unsigned int new_size = alloc_size * 2;
            unsigned char *new_out = realloc(out, new_size);
            if (!new_out) {
                inflateEnd(&strm);
                free(out);
                return NULL;
            }
            out = new_out;
            strm.next_out = out + alloc_size;
            strm.avail_out = new_size - alloc_size;
            alloc_size = new_size;
        }
    }

    inflateEnd(&strm);
    *out_size = strm.total_out;
    return out;
}
