/* Simple wrapper to expose bz2 decompression for CRAM bzip2 blocks */
#include <bzlib.h>
#include <stdlib.h>

unsigned char *bz2_uncompress(unsigned char *in, unsigned int in_size,
                              unsigned int *out_size) {
    if (in_size < 4)
        return NULL;

    /* First 4 bytes contain the uncompressed size (little-endian) */
    unsigned int usize = in[0] | (in[1] << 8) | (in[2] << 16) | (in[3] << 24);

    unsigned char *out = malloc(usize);
    if (!out)
        return NULL;

    unsigned int dest_len = usize;
    int ret = BZ2_bzBuffToBuffDecompress((char *)out, &dest_len,
                                         (char *)in + 4, in_size - 4,
                                         0, 0);
    if (ret != BZ_OK) {
        free(out);
        return NULL;
    }

    *out_size = dest_len;
    return out;
}
