import { DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop"

const proxyPreferenceKey = "easyssh:network-proxy"
export type DesktopProxyMode = "system" | "direct" | "manual"
export type DesktopProxyConfig = {
  mode: DesktopProxyMode
  url: string
  username: string
  password: string
  passwordSet: boolean
  hasPassword: boolean
}
export const defaultDesktopProxyConfig: DesktopProxyConfig = {
  mode: "system", url: "", username: "", password: "", passwordSet: false, hasPassword: false,
}

export function isValidDesktopProxyURL(value: string): boolean {
  try {
    const url = new URL(value.trim())
    // URL normalizes default ports (80/443) to an empty string.
    const authority = value.trim().split("://")[1]?.split("/")[0] ?? ""
    const port = authority.match(/:(\d+)$/)?.[1]
    return ["http:", "https:", "socks5:"].includes(url.protocol)
      && Boolean(url.hostname) && Boolean(port) && Number(port) > 0 && Number(port) <= 65535
      && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === "" || url.pathname === "/")
  } catch {
    return false
  }
}

export function isValidDesktopProxyCredentials(config: DesktopProxyConfig): boolean {
  if (config.mode !== "manual") return true
  if (!config.username) return !config.password
  if (!isValidDesktopProxyURL(config.url)) return true // Address validation reports this separately.
  if (new URL(config.url.trim()).protocol !== "socks5:") return !config.username.includes(":")
  const encoder = new TextEncoder()
  const passwordBytes = encoder.encode(config.password).length
  return encoder.encode(config.username).length <= 255
    && ((!config.passwordSet && config.hasPassword) || (passwordBytes >= 1 && passwordBytes <= 255))
}

export async function loadDesktopProxyConfig(): Promise<DesktopProxyConfig> {
  const preferences = await DesktopService.ListPreferences()
  const value = preferences[proxyPreferenceKey]
  if (!value) return { ...defaultDesktopProxyConfig }
  const config: DesktopProxyConfig = { ...defaultDesktopProxyConfig, ...JSON.parse(value), password: "", passwordSet: false }
  if (!["system", "direct", "manual"].includes(config.mode)
    || typeof config.url !== "string"
    || typeof config.username !== "string"
    || typeof config.hasPassword !== "boolean"
    || (config.mode === "manual" && !isValidDesktopProxyURL(config.url))) {
    throw new Error("Invalid network proxy settings")
  }
  return config
}

export async function saveDesktopProxyConfig(config: DesktopProxyConfig): Promise<void> {
  await DesktopService.SetPreference(proxyPreferenceKey, JSON.stringify({
    mode: config.mode,
    url: config.mode === "manual" ? config.url.trim() : "",
    username: config.mode === "manual" ? config.username : "",
    password: config.mode === "manual" ? config.password : "",
    passwordSet: config.passwordSet,
  }))
}
