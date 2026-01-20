/**
 * CRAM core block codec implementations for WASM
 *
 * These codecs decode bit-packed data from the CRAM core data block.
 * Implemented in C for compilation to WebAssembly to improve performance
 * over JavaScript implementations.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/**
 * Cursor state for bit-level reading
 * Note: bitPosition counts down from 7 to 0 within each byte
 */
typedef struct {
    uint32_t bytePosition;
    int8_t bitPosition;  // 7 down to 0
} BitCursor;

/**
 * Read a single bit from the data buffer
 */
static inline int read_bit(const uint8_t* data, BitCursor* cursor) {
    int bit = (data[cursor->bytePosition] >> cursor->bitPosition) & 1;
    cursor->bitPosition--;
    if (cursor->bitPosition < 0) {
        cursor->bytePosition++;
        cursor->bitPosition = 7;
    }
    return bit;
}

/**
 * Read multiple bits from the data buffer
 */
static inline uint32_t read_bits(const uint8_t* data, BitCursor* cursor, int numBits) {
    uint32_t val = 0;
    for (int i = 0; i < numBits; i++) {
        val <<= 1;
        val |= (data[cursor->bytePosition] >> cursor->bitPosition) & 1;
        cursor->bitPosition--;
        if (cursor->bitPosition < 0) {
            cursor->bytePosition++;
            cursor->bitPosition = 7;
        }
    }
    return val;
}

/**
 * Decode a single gamma-encoded value
 *
 * Gamma encoding: unary count of leading zeros followed by binary value
 * Used extensively in CRAM for variable-length integers
 */
int32_t decode_gamma(
    const uint8_t* data,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t offset
) {
    BitCursor cursor = { *bytePos, *bitPos };

    // Count leading zeros (each 0 bit increases length)
    int length = 1;
    while (read_bit(data, &cursor) == 0) {
        length++;
    }

    // Read (length - 1) more bits for the value
    uint32_t readBits = 0;
    if (length > 1) {
        readBits = read_bits(data, &cursor, length - 1);
    }

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;

    int32_t value = readBits | (1 << (length - 1));
    return value - offset;
}

/**
 * Decode multiple gamma-encoded values in bulk
 * More efficient than calling decode_gamma in a loop due to reduced
 * function call overhead and better instruction cache utilization
 *
 * Returns the number of values decoded (should equal count)
 */
int32_t decode_gamma_bulk(
    const uint8_t* data,
    uint32_t dataLen,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t offset,
    int32_t* output,
    int32_t count
) {
    BitCursor cursor = { *bytePos, *bitPos };

    for (int32_t n = 0; n < count; n++) {
        // Bounds check
        if (cursor.bytePosition >= dataLen) {
            *bytePos = cursor.bytePosition;
            *bitPos = cursor.bitPosition;
            return n;  // Return number decoded before error
        }

        // Count leading zeros
        int length = 1;
        while (read_bit(data, &cursor) == 0) {
            length++;
            if (cursor.bytePosition >= dataLen) {
                *bytePos = cursor.bytePosition;
                *bitPos = cursor.bitPosition;
                return n;
            }
        }

        // Read (length - 1) more bits
        uint32_t readBits = 0;
        if (length > 1) {
            readBits = read_bits(data, &cursor, length - 1);
        }

        output[n] = (readBits | (1 << (length - 1))) - offset;
    }

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;
    return count;
}

/**
 * Decode a single beta-encoded value
 *
 * Beta encoding: fixed-width binary encoding
 * numBits specifies the number of bits to read
 */
int32_t decode_beta(
    const uint8_t* data,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t numBits,
    int32_t offset
) {
    BitCursor cursor = { *bytePos, *bitPos };

    // Fast path: reading exactly 8 bits when byte-aligned
    if (numBits == 8 && cursor.bitPosition == 7) {
        uint32_t val = data[cursor.bytePosition];
        cursor.bytePosition++;
        *bytePos = cursor.bytePosition;
        *bitPos = cursor.bitPosition;
        return val - offset;
    }

    uint32_t val = read_bits(data, &cursor, numBits);

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;
    return val - offset;
}

/**
 * Decode multiple beta-encoded values in bulk
 */
int32_t decode_beta_bulk(
    const uint8_t* data,
    uint32_t dataLen,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t numBits,
    int32_t offset,
    int32_t* output,
    int32_t count
) {
    BitCursor cursor = { *bytePos, *bitPos };

    for (int32_t n = 0; n < count; n++) {
        if (cursor.bytePosition >= dataLen) {
            *bytePos = cursor.bytePosition;
            *bitPos = cursor.bitPosition;
            return n;
        }

        // Fast path for byte-aligned 8-bit reads
        if (numBits == 8 && cursor.bitPosition == 7) {
            output[n] = data[cursor.bytePosition] - offset;
            cursor.bytePosition++;
        } else {
            output[n] = read_bits(data, &cursor, numBits) - offset;
        }
    }

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;
    return count;
}

/**
 * Decode a single subexp-encoded value
 *
 * Subexponential encoding: count of leading 1s determines the number of
 * bits to read for the value
 */
int32_t decode_subexp(
    const uint8_t* data,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t K,
    int32_t offset
) {
    BitCursor cursor = { *bytePos, *bitPos };

    // Count leading ones
    int numLeadingOnes = 0;
    while (read_bit(data, &cursor) == 1) {
        numLeadingOnes++;
    }

    // Determine how many bits to read for the value
    int b = (numLeadingOnes == 0) ? K : (numLeadingOnes + K - 1);

    // Read b bits
    uint32_t bits = read_bits(data, &cursor, b);

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;

    int32_t n = (numLeadingOnes == 0) ? bits : ((1 << b) | bits);
    return n - offset;
}

/**
 * Decode multiple subexp-encoded values in bulk
 */
int32_t decode_subexp_bulk(
    const uint8_t* data,
    uint32_t dataLen,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t K,
    int32_t offset,
    int32_t* output,
    int32_t count
) {
    BitCursor cursor = { *bytePos, *bitPos };

    for (int32_t n = 0; n < count; n++) {
        if (cursor.bytePosition >= dataLen) {
            *bytePos = cursor.bytePosition;
            *bitPos = cursor.bitPosition;
            return n;
        }

        // Count leading ones
        int numLeadingOnes = 0;
        while (read_bit(data, &cursor) == 1) {
            numLeadingOnes++;
            if (cursor.bytePosition >= dataLen) {
                *bytePos = cursor.bytePosition;
                *bitPos = cursor.bitPosition;
                return n;
            }
        }

        // Determine how many bits to read
        int b = (numLeadingOnes == 0) ? K : (numLeadingOnes + K - 1);

        // Read b bits
        uint32_t bits = read_bits(data, &cursor, b);

        output[n] = (numLeadingOnes == 0) ? (bits - offset) : (((1 << b) | bits) - offset);
    }

    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;
    return count;
}

/**
 * Read multiple bits and return as uint32 (for huffman)
 * Exposed for direct use from JS when needed
 */
uint32_t read_bits_direct(
    const uint8_t* data,
    uint32_t* bytePos,
    int8_t* bitPos,
    int32_t numBits
) {
    BitCursor cursor = { *bytePos, *bitPos };
    uint32_t val = read_bits(data, &cursor, numBits);
    *bytePos = cursor.bytePosition;
    *bitPos = cursor.bitPosition;
    return val;
}
