import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildLoginRedirectUrl,
  getAuthRedirectDecision,
  getLoginNextPath,
  getSafeAuthNextPath,
  getSafeInternalPath,
  isLoginPath,
} from "../src/platform/auth-redirect"
import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"

const unauthenticated = status({ is_authenticated: false })
const authenticated = status({ is_authenticated: true })

describe("auth redirect decisions", () => {
  it("sends missing status to login except on the login page", () => {
    assert.deepEqual(getAuthRedirectDecision("home", null), {
      type: "redirect",
      href: "/login",
    })
    assert.deepEqual(getAuthRedirectDecision("dashboard", null, { currentPath: "/dashboard/hosts" }), {
      type: "redirect",
      href: "/login?next=%2Fdashboard%2Fhosts",
    })
    assert.deepEqual(getAuthRedirectDecision("login", null), { type: "stay" })
    assert.deepEqual(getAuthRedirectDecision("setup", null), { type: "stay" })
  })

  it("prioritizes setup before other auth states", () => {
    assert.deepEqual(getAuthRedirectDecision("login", status({ need_init: true })), {
      type: "redirect",
      href: "/setup",
    })
    assert.deepEqual(getAuthRedirectDecision("setup", status({ need_init: true })), { type: "stay" })
  })

  it("keeps unauthenticated users on login and redirects protected pages", () => {
    assert.deepEqual(getAuthRedirectDecision("login", unauthenticated), { type: "stay" })
    assert.deepEqual(getAuthRedirectDecision("dashboard", unauthenticated, { currentPath: "/dashboard?tab=ssh" }), {
      type: "redirect",
      href: "/login?next=%2Fdashboard%3Ftab%3Dssh",
    })
    assert.deepEqual(getAuthRedirectDecision("setup", unauthenticated, { currentPath: "/setup" }), {
      type: "redirect",
      href: "/login",
    })
  })

  it("sends authenticated users to the dashboard overview from public entry pages", () => {
    assert.deepEqual(getAuthRedirectDecision("home", authenticated, { currentPath: "/?next=/dashboard/scripts" }), {
      type: "redirect",
      href: "/dashboard",
    })
    assert.deepEqual(getAuthRedirectDecision("login", authenticated, { currentPath: "/login?next=/dashboard/scripts" }), {
      type: "redirect",
      href: "/dashboard/scripts",
    })
    assert.deepEqual(getAuthRedirectDecision("setup", authenticated), {
      type: "redirect",
      href: "/dashboard",
    })
  })
})

describe("auth redirect helpers", () => {
  it("filters unsafe next targets", () => {
    assert.equal(getSafeAuthNextPath("/dashboard"), "/dashboard")
    assert.equal(getSafeAuthNextPath("//evil.example"), null)
    assert.equal(getSafeAuthNextPath("https://evil.example"), null)
    assert.equal(getSafeAuthNextPath("/login?next=/dashboard"), null)
    assert.equal(getSafeAuthNextPath("/login-help"), "/login-help")
    assert.equal(getSafeAuthNextPath("/"), null)
  })

  it("allows safe internal paths for non-auth-next redirects", () => {
    assert.equal(getSafeInternalPath("/login?account_settings=security"), "/login?account_settings=security")
    assert.equal(getSafeInternalPath("//evil.example"), null)
    assert.equal(getSafeInternalPath("https://evil.example"), null)
  })

  it("extracts next from login URLs only when safe", () => {
    assert.equal(getLoginNextPath("/login?next=/dashboard/hosts"), "/dashboard/hosts")
    assert.equal(getLoginNextPath("/login?next=//evil.example"), null)
  })

  it("builds login URLs consistently", () => {
    assert.equal(buildLoginRedirectUrl("/dashboard/hosts"), "/login?next=%2Fdashboard%2Fhosts")
    assert.equal(buildLoginRedirectUrl("/login"), "/login")
    assert.equal(buildLoginRedirectUrl("/login-help"), "/login?next=%2Flogin-help")
  })

  it("matches only the real login route", () => {
    assert.equal(isLoginPath("/login"), true)
    assert.equal(isLoginPath("/login?next=/dashboard"), true)
    assert.equal(isLoginPath("/login-help"), false)
    assert.equal(isLoginPath("/dashboard/login"), false)
  })
})

function status(overrides: Partial<AuthStatusResponse>): AuthStatusResponse {
  return {
    need_init: false,
    is_authenticated: false,
    ...overrides,
  }
}
