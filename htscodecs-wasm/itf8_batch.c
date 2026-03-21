#include <stdint.h>

// Batch decode all ITF8 values from a buffer.
// Returns the number of values decoded.
// out must be pre-allocated with enough space (at most in_size values).
int batch_itf8_decode(const uint8_t *in, int in_size, int32_t *out) {
    int count = 0;
    int pos = 0;

    while (pos < in_size) {
        uint8_t b0 = in[pos];

        if (b0 < 0x80) {
            out[count++] = b0;
            pos += 1;
        } else if (b0 < 0xC0) {
            if (pos + 1 >= in_size) break;
            out[count++] = ((b0 & 0x3F) << 8) | in[pos + 1];
            pos += 2;
        } else if (b0 < 0xE0) {
            if (pos + 2 >= in_size) break;
            out[count++] = ((b0 & 0x1F) << 16)
                         | (in[pos + 1] << 8)
                         |  in[pos + 2];
            pos += 3;
        } else if (b0 < 0xF0) {
            if (pos + 3 >= in_size) break;
            out[count++] = ((b0 & 0x0F) << 24)
                         | (in[pos + 1] << 16)
                         | (in[pos + 2] << 8)
                         |  in[pos + 3];
            pos += 4;
        } else {
            if (pos + 4 >= in_size) break;
            out[count++] = ((b0 & 0x0F) << 28)
                         | (in[pos + 1] << 20)
                         | (in[pos + 2] << 12)
                         | (in[pos + 3] << 4)
                         | (in[pos + 4] & 0x0F);
            pos += 5;
        }
    }

    return count;
}
