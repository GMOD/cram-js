/* config.h for htscodecs WASM build */

/* Package version */
#define PACKAGE_VERSION "1.6.5"

/* Define if you have __builtin_prefetch */
#define HAVE_BUILTIN_PREFETCH 1

/* bz2 support via emscripten port */
#define HAVE_LIBBZ2 1

/* No SIMD in WASM (yet) */
/* #undef HAVE_AVX2 */
/* #undef HAVE_AVX512 */
/* #undef HAVE_SSE4_1 */
/* #undef HAVE_SSSE3 */
/* #undef HAVE_POPCNT */
/* #undef HAVE_NEON */

/* No thread-local storage needed */
/* #undef HAVE_HTSCODECS_TLS_CPU_INIT */

/* Standard headers */
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
