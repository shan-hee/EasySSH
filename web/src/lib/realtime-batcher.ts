interface LatestByKeyBatcherOptions<T, K> {
  keyOf: (item: T) => K
  onFlush: (items: T[]) => void
  delayMs?: number
}

export interface LatestByKeyBatcher<T> {
  enqueue: (item: T) => void
  flush: () => void
  dispose: () => void
}

export function mergeLatestByKey<T, K>(
  current: readonly T[],
  updates: readonly T[],
  keyOf: (item: T) => K,
): T[] {
  if (updates.length === 0) return [...current]

  const merged = new Map<K, T>()
  current.forEach((item) => merged.set(keyOf(item), item))
  updates.forEach((item) => merged.set(keyOf(item), item))
  return Array.from(merged.values())
}

export function createLatestByKeyBatcher<T, K>({
  keyOf,
  onFlush,
  delayMs = 80,
}: LatestByKeyBatcherOptions<T, K>): LatestByKeyBatcher<T> {
  const pending = new Map<K, T>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const flush = () => {
    if (disposed) return
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return

    const items = Array.from(pending.values())
    pending.clear()
    onFlush(items)
  }

  return {
    enqueue(item) {
      if (disposed) return
      pending.set(keyOf(item), item)
      if (timer === null) {
        timer = setTimeout(flush, delayMs)
      }
    },
    flush,
    dispose() {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending.clear()
    },
  }
}
