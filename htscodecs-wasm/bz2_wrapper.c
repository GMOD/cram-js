/* Simple wrapper to expose bz2 decompression for CRAM bzip2 blocks */
#include <bzlib.h>
#include <stdlib.h>

/* Decompress bzip2 data. Caller provides expected uncompressed size. */
unsigned char *bz2_uncompress(unsigned char *in, unsigned int in_size,
                              unsigned int expected_size,
                              unsigned int *out_size) {
    if (in_size == 0) {
        *out_size = 0;
        return malloc(1); /* Return non-NULL for empty input */
    }

    unsigned char *out = malloc(expected_size);
    if (!out)
        return NULL;

    unsigned int dest_len = expected_size;
    int ret = BZ2_bzBuffToBuffDecompress((char *)out, &dest_len,
                                         (char *)in, in_size,
                                         0, 0);
    if (ret != BZ_OK) {
        free(out);
        return NULL;
    }

    *out_size = dest_len;
    return out;
}
