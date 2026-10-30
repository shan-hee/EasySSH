export const DEFAULT_TRANSFER_CONCURRENCY_LIMIT = 3

export type ReleaseTransferRuntimeSlot = () => void

export interface TransferConcurrencyLimiter {
  acquire: () => Promise<ReleaseTransferRuntimeSlot>
  getActiveCount: () => number
  getQueuedCount: () => number
}

export interface CreateTransferConcurrencyLimiterOptions {
  maxConcurrent?: number
}

/** 限制同时从本机发送的上传数量，其余按提交顺序排队。 */
export function createTransferConcurrencyLimiter({
  maxConcurrent = DEFAULT_TRANSFER_CONCURRENCY_LIMIT,
}: CreateTransferConcurrencyLimiterOptions = {}): TransferConcurrencyLimiter {
  const limit = Math.max(1, Math.floor(maxConcurrent))
  const state = {
    active: 0,
    queue: [] as Array<() => void>,
  }

  return {
    acquire() {
      return new Promise<ReleaseTransferRuntimeSlot>((resolve) => {
        const grant = () => {
          state.active += 1
          let released = false

          resolve(() => {
            if (released) return
            released = true
            state.active = Math.max(0, state.active - 1)
            const next = state.queue.shift()
            if (next) {
              next()
            }
          })
        }

        if (state.active < limit) {
          grant()
        } else {
          state.queue.push(grant)
        }
      })
    },
    getActiveCount() {
      return state.active
    },
    getQueuedCount() {
      return state.queue.length
    },
  }
}
