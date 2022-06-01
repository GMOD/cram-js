declare module '@gmod/binary-parser' {
  export type Options = {
    stripNull?: boolean
    formatter?: (item: any) => any
    length?: number | string | ((this: { $parent: unknown }) => void)
  }

  export class Parser<T = unknown> {
    public static start<TStart>(): Parser<TStart>

    public uint8(name?: string | null, options?: Options): Parser

    public itf8(name?: string | null, options?: Options): Parser

    public ltf8(name?: string | null, options?: Options): Parser

    public uint32(name?: string | null, options?: Options): Parser

    public int32(name?: string | null, options?: Options): Parser

    public buffer(name?: string | null, options?: Options): Parser

    public string(name?: string | null, options?: Options): Parser

    public namely(name: string): Parser

    public nest(
      name?: string | null,
      options?: { type: Parser | string } & Options,
    ): Parser

    public choice(
      name?: string | null,
      options?: { tag: string; choices: any } & Options,
    ): Parser

    public array(
      name?: string | null,
      options?: { type: string | Parser } & Options,
    ): Parser

    parse(bytes: Buffer): { result: T; offset: number }
  }
}
