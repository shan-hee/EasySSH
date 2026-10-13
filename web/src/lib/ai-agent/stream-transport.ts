import { authenticatedFetch } from "@/lib/api-client"

export class AIStreamConnectionError extends Error {
  constructor(message = "AI stream connection interrupted") {
    super(message)
    this.name = "AIStreamConnectionError"
  }
}

class AIStreamHTTPError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "AIStreamHTTPError"
  }
}

export function isRecoverableAIStreamError(error: unknown) {
  return error instanceof AIStreamConnectionError
    || (error instanceof AIStreamHTTPError && (error.status === 408 || error.status === 429 || error.status >= 500))
}

// The server sends a heartbeat every 15s, including while tools are running.
// Bound both connection setup and silent stalls; never retry a chat POST here.
export async function fetchAIChatStream(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  let timeout: ReturnType<typeof setTimeout> | undefined
  const armTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(new AIStreamConnectionError("AI stream connection timed out")), 45_000)
  }
  const connectionError = (error: unknown) => {
    if (init.signal?.aborted) return init.signal.reason
    if (controller.signal.aborted) return controller.signal.reason
    return new AIStreamConnectionError(error instanceof Error ? error.message : String(error))
  }

  armTimeout()
  try {
    const response = await authenticatedFetch(input, { ...init, signal }, { minValidityMs: 60_000 })
    if (!response.ok) {
      const text = await response.text()
      let message = text || `HTTP ${response.status}`
      try {
        const detail = JSON.parse(text) as { message?: string }
        if (detail.message) message = detail.message
      } catch { /* Preserve plain-text HTTP errors. */ }
      throw new AIStreamHTTPError(message, response.status)
    }
    if (!response.body) throw new AIStreamConnectionError("AI stream response body is empty")

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let tail = ""
    let completed = false
    armTimeout()
    return new Response(new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const { value, done } = await reader.read()
          if (done) {
            clearTimeout(timeout)
            if (!completed) throw new AIStreamConnectionError("AI stream ended before completion")
            output.close()
            return
          }
          armTimeout()
          const text = tail + decoder.decode(value, { stream: true })
          completed ||= /(?:^|\n)data: ?\[DONE\]\r?\n/.test(text)
          tail = text.slice(-64)
          output.enqueue(value)
        } catch (error) {
          clearTimeout(timeout)
          output.error(connectionError(error))
        }
      },
      async cancel(reason) {
        clearTimeout(timeout)
        controller.abort(reason)
        await reader.cancel(reason).catch(() => {})
      },
    }), { status: response.status, headers: response.headers })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof AIStreamHTTPError) throw error
    if (error instanceof TypeError || signal.aborted || error instanceof AIStreamConnectionError) {
      throw connectionError(error)
    }
    // Authentication and other application failures are not connection retries.
    throw error
  }
}
