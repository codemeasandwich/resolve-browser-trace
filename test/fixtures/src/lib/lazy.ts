export function lazyFail(reason: string): never {
  throw new TypeError(`lazy chunk failed: ${reason}`)
}
