function sum(array: Uint8Array[]) {
  let sum = 0
  for (const entry of array) {
    sum += entry.length
  }
  return sum
}
export function concatUint8Array(args: Uint8Array[]) {
  const mergedArray = new Uint8Array(sum(args))
  let offset = 0
  for (const entry of args) {
    mergedArray.set(entry, offset)
    offset += entry.length
  }
  return mergedArray
}
