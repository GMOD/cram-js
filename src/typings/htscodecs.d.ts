declare module '@jkbonfield/htscodecs' {
  function r4x16_uncompress(input: Buffer, output: Buffer): void
  function arith_uncompress(input: Buffer, output: Buffer): void
  function fqzcomp_uncompress(input: Buffer, output: Buffer): void
  function tok3_uncompress(input: Buffer, output: Buffer): void
}
