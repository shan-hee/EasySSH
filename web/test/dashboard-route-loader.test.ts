import assert from "node:assert/strict"
import { afterEach, describe, it, mock } from "node:test"
import { QueryClient } from "@tanstack/react-query"
import { createMemoryRouter } from "react-router-dom"
import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"
import type { SystemConfig } from "@easyssh/app/lib/api/settings"
import { authSession } from "../src/platform/auth-session"
import { authStatusQueryKey, authStatusQueryOptions } from "../src/platform/auth-status-query"
import { createDashboardPageLoader } from "../src/lib/dashboard-route-loader"
import type { DashboardRouteDefinition } from "../src/lib/dashboard-route-registry"
import { runtimeApi } from "@easyssh/app/shell/runtime/api"
import { runtimeInfoQueryKey } from "@easyssh/app/shell/runtime/use-runtime-info"
import type { RuntimeInfo } from "@easyssh/app/shell/runtime/types"

const status: AuthStatusResponse = {
  need_init: false,
  is_authenticated: true,
  system_config: { system_name: "EasySSH" } as SystemConfig,
  user: { id: "owner-1", username: "owner", email: "owner@example.com", created_at: "", updated_at: "" },
}
const runtime: RuntimeInfo = {
  profile: "web", principal: { kind: "owner" },
  single_user: true, portable: false, managed: false,
  capabilities: { servers: true, terminal: true },
}
const clients: QueryClient[] = []
function client(auth = status) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  queryClient.setQueryData(authStatusQueryKey, auth)
  queryClient.setQueryData(runtimeInfoQueryKey, runtime)
  clients.push(queryClient)
  return queryClient
}
function route(loadData: DashboardRouteDefinition["loadData"]): DashboardRouteDefinition {
  return { url: "/dashboard/terminal", path: "terminal", namespaces: [], load: async () => ({ default: () => null }), loadData }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function args(path: string, signal?: AbortSignal) {
  const url = new URL(path, "https://example.com")
  return { request: new Request(url, { signal }), url, pattern: url.pathname, params: {}, context: undefined }
}

afterEach(() => {
  mock.restoreAll()
  for (const queryClient of clients.splice(0)) queryClient.clear()
})

describe("dashboard data navigation", () => {
  it("redirects before starting business data requests for an unauthenticated user", async () => {
    const loadData = mock.fn(async () => undefined)
    const loader = createDashboardPageLoader(client({ ...status, is_authenticated: false, user: undefined }), route(loadData))
    await assert.rejects(loader(args("/dashboard/terminal")), (error: unknown) => (
      error instanceof Response && error.headers.get("Location") === "/login?next=%2Fdashboard%2Fterminal"
    ))
    assert.equal(loadData.mock.callCount(), 0)
  })

  it("checks target capabilities before starting business data requests", async () => {
    const loadData = mock.fn(async () => undefined)
    const loader = createDashboardPageLoader(client(), route(loadData))
    await assert.rejects(loader(args("/dashboard/logs")), (error: unknown) => (
      error instanceof Response && error.headers.get("Location") === "/dashboard/terminal"
    ))
    assert.equal(loadData.mock.callCount(), 0)
  })

  it("shares authentication restoration across concurrent loaders and the provider query", async () => {
    const queryClient = client()
    queryClient.removeQueries({ queryKey: authStatusQueryKey })
    const pending = deferred<AuthStatusResponse>()
    const checkStatus = mock.method(authSession, "checkStatus", () => pending.promise)
    mock.method(runtimeApi, "getRuntime", async () => runtime)
    const loader = createDashboardPageLoader(queryClient, route(async () => undefined))
    const work = Promise.all([
      loader(args("/dashboard/terminal")), loader(args("/dashboard/terminal")),
      queryClient.fetchQuery(authStatusQueryOptions()),
    ])
    pending.resolve(status)
    await work
    assert.equal(checkStatus.mock.callCount(), 1)
  })

  it("does not start business data requests for a navigation cancelled during authentication", async () => {
    const queryClient = client()
    queryClient.removeQueries({ queryKey: authStatusQueryKey })
    const pending = deferred<AuthStatusResponse>()
    mock.method(authSession, "checkStatus", () => pending.promise)
    const loadData = mock.fn(async () => undefined)
    const controller = new AbortController()
    const result = createDashboardPageLoader(queryClient, route(loadData))(args("/dashboard/terminal", controller.signal))
    controller.abort()
    pending.resolve(status)
    await assert.rejects(result, { name: "AbortError" })
    assert.equal(loadData.mock.callCount(), 0)
  })

  it("keeps the previous route until data is ready, then uses cached data on return", async () => {
    const queryClient = client()
    const pending = deferred<string>()
    const started = deferred<void>()
    const queryFn = mock.fn(() => { started.resolve(); return pending.promise })
    const loader = createDashboardPageLoader(queryClient, route((cache) => cache.ensureQueryData({ queryKey: ["page-data"], queryFn })))
    const router = createMemoryRouter([
      { path: "/previous" },
      { path: "/dashboard/terminal", loader },
    ], { initialEntries: ["/previous"] })
    try {
      const navigation = router.navigate("/dashboard/terminal")
      await started.promise
      assert.equal(router.state.location.pathname, "/previous")
      assert.equal(router.state.navigation.state, "loading")
      pending.resolve("ready")
      await navigation
      assert.equal(router.state.location.pathname, "/dashboard/terminal")
      assert.equal(router.state.navigation.state, "idle")
      await router.navigate("/previous")
      await router.navigate("/dashboard/terminal")
      assert.equal(queryFn.mock.callCount(), 1)
    } finally {
      router.dispose()
    }
  })
})
