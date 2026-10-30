import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import type { DesktopRemoteFrame } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"

export function decodeRemoteBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
const streams = new Map<string, () => void>()
export async function closeRemoteStreams() {
  const entries = [...streams]
  entries.forEach(([, stop]) => stop())
  await Promise.allSettled(entries.map(([id]) => Remote.CloseStream(id)))
}
export function readRemoteStream(
  id: string,
  frame: (value: DesktopRemoteFrame) => void,
  closed: (reason?: string) => void,
) {
  let stopped = false
  streams.set(id, () => {
    stopped = true
    streams.delete(id)
    closed("workspace_closed")
  })
  void (async () => {
    let cursor = 0
    try {
      while (!stopped) {
        const batch = await Remote.ReadStream(id, cursor)
        if (stopped) break
        for (const item of batch.frames) {
          if (stopped) break
          if (item.sequence <= cursor) continue
          if (item.sequence !== cursor + 1)
            throw new Error("Remote stream sequence interrupted")
          frame(item)
          cursor = item.sequence
        }
        if (!stopped && batch.closed) {
          closed(batch.reason)
          break
        }
      }
    } catch (error) {
      if (!stopped) closed(String(error))
    } finally {
      streams.delete(id)
      await Remote.CloseStream(id).catch(() => undefined)
    }
  })()
  return () => {
    stopped = true
    streams.delete(id)
    void Remote.CloseStream(id).catch(() => undefined)
  }
}

export function remoteAIResponse(id: string, signal?: AbortSignal | null) {
  let stop: (() => void) | undefined
  let abort: (() => void) | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false
      const finish = (reason?: string) => {
        if (ended) return
        ended = true
        if (abort) signal?.removeEventListener("abort", abort)
        if (
          reason &&
          reason !== "EOF" &&
          reason !== "closed" &&
          reason !== "ai_stream_completed"
        )
          controller.error(new Error(reason))
        else controller.close()
      }
      stop = readRemoteStream(
        id,
        (frame) => {
          if (frame.encoding !== "ai.sse")
            throw new Error("Unexpected AI frame")
          controller.enqueue(decodeRemoteBytes(frame.data))
        },
        finish,
      )
      abort = () => {
        stop?.()
        finish("Request aborted")
      }
      if (signal?.aborted) abort()
      else signal?.addEventListener("abort", abort, { once: true })
    },
    cancel() {
      if (abort) signal?.removeEventListener("abort", abort)
      stop?.()
    },
  })
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  })
}
