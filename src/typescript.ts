export type TupleOf<T, N extends number> = N extends N
  ? number extends N
    ? T[]
    : _TupleOf<T, N, []>
  : never
export type _TupleOf<
  T,
  N extends number,
  R extends unknown[],
> = R['length'] extends N ? R : _TupleOf<T, N, [T, ...R]>
