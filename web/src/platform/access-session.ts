import type { PlatformTransport } from "@easyssh/app/contracts/platform-transport"
import type { components } from "@easyssh/app/generated/openapi"
import { getApiUrl, getWsUrl } from "./config"

type Exchange = components["schemas"]["BrowserAccessExchange"]
export const isSharePage = () => window.location.pathname.startsWith("/share/")
let current: Exchange | null = null
let currentPublicId = ""
let starting: Promise<Exchange> | null = null
let generation = 0
const listeners = new Set<() => void>()
const key = (publicId: string) => `easyssh:access:/share/${publicId}`
const notify = () => listeners.forEach((fn) => fn())
async function responseJSON<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok)
    throw Object.assign(
      new Error(body.message || body.error || `HTTP ${response.status}`),
      { status: response.status },
    )
  return body as T
}
export const accessSession = {
  start(publicId: string): Promise<Exchange> {
    if (starting && currentPublicId === publicId && !window.location.hash)
      return starting
    const secret = window.location.hash.slice(1)
    // Exchange the secret once and remove it before mounting any workspace UI.
    if (secret)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      )
    const version = ++generation
    currentPublicId = publicId
    current = null
    notify()
    starting = (async () => {
      let exchange: Exchange
      if (secret) {
        exchange = await responseJSON<Exchange>(
          await fetch(`${getApiUrl()}/access/exchanges`, {
            method: "POST",
            credentials: "same-origin",
            referrerPolicy: "no-referrer",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              public_id: publicId,
              secret,
              client_kind: "browser",
              protocol_min: 1,
              protocol_max: 1,
            }),
          }),
        )
      } else {
        const saved = JSON.parse(
          sessionStorage.getItem(key(publicId)) || "null",
        ) as { session: string; csrf: string } | null
        if (!saved?.session || !saved.csrf)
          throw new Error(
            "请重新打开完整分享链接 / Reopen the complete share link",
          )
        const context = await responseJSON<Exchange["context"]>(
          await fetch(`${getApiUrl()}/access/context`, {
            credentials: "same-origin",
            headers: { "X-EasySSH-Access-Session": saved.session },
            cache: "no-store",
          }),
        )
        exchange = { context, csrf_token: saved.csrf }
      }
      if (version !== generation) throw new Error("Access workspace changed")
      if (
        exchange.context.protocol_version !== 1 ||
        exchange.context.actor.kind !== "access_session"
      )
        throw new Error("Unsupported access session")
      current = exchange
      sessionStorage.setItem(
        key(publicId),
        JSON.stringify({
          session: exchange.context.actor.session_id,
          csrf: exchange.csrf_token,
        }),
      )
      notify()
      return exchange
    })().catch((error) => {
      if (version === generation) {
        starting = null
        current = null
        if (error?.status === 401) sessionStorage.removeItem(key(publicId))
      }
      throw error
    })
    return starting
  },
  async refresh() {
    const previous = current
    const version = generation
    if (!previous) throw new Error("Access session has ended")
    const context = await responseJSON<Exchange["context"]>(
      await accessTransport.fetch(`${getApiUrl()}/access/context`),
    )
    if (version !== generation) throw new Error("Access workspace changed")
    current = { ...previous, context }
    return context
  },
  end() {
    generation++
    current = null
    starting = null
    sessionStorage.removeItem(key(currentPublicId))
    notify()
  },
}

export const accessTransport: PlatformTransport = {
  apiBaseUrl: getApiUrl,
  webSocketUrl: getWsUrl,
  hasCredentials: () => current !== null,
  subscribeCredentials: (fn) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  requestHeaders: async (method) => {
    if (!current) throw new Error("Access session has ended")
    return {
      "X-EasySSH-Access-Session": current.context.actor.session_id,
      ...(!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
        ? { "X-CSRF-Token": current.csrf_token }
        : {}),
    }
  },
  async fetch(input, init = {}) {
    const version = generation
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input), window.location.origin)
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith(`${getApiUrl()}/`)
    )
      throw new Error("Access requests must stay in the shared workspace")
    const headers = new Headers(request?.headers)
    new Headers(init.headers).forEach((v, k) => headers.set(k, v))
    const method = init.method ?? request?.method ?? "GET"
    for (const [k, v] of Object.entries(
      await accessTransport.requestHeaders(method),
    ))
      headers.set(k, v)
    const response = await fetch(input, {
      ...init,
      headers,
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
    })
    if (response.status === 401 && version === generation) accessSession.end()
    return response
  },
}
