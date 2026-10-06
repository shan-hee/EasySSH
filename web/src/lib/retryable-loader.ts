// 失败状态保留到用户显式重试，避免 Suspense 在断网时无限重发请求。
export function createRetryableLoader<T>(loader: () => Promise<T>) {
  let promise: Promise<void> | undefined
  let result: T
  let ready = false
  let error: unknown
  let failed = false
  const load = () => {
    if (!promise) {
      promise = loader().then(
        (value) => { result = value; ready = true },
        (cause: unknown) => { error = cause; failed = true },
      )
    }
    return promise
  }
  return {
    load,
    read(): T {
      if (failed) throw error
      if (!ready) throw load()
      return result
    },
    reset() {
      if (failed) {
        promise = undefined
        error = undefined
        failed = false
      }
    },
  }
}
