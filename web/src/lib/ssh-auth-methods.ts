import type { AuthMethod } from "@/lib/server-types"

export const SSH_AUTH_METHODS = [
  "password",
  "key",
  "password_keyboard",
  "key_keyboard",
  "key_password",
  "key_password_keyboard",
  "password_key",
  "password_key_keyboard",
  "keyboard_interactive",
] as const satisfies readonly AuthMethod[]

const SSH_AUTH_METHOD_ALIASES = [
  "keyboard",
] as const satisfies readonly AuthMethod[]

export type SSHAuthMethod = (typeof SSH_AUTH_METHODS)[number]
export type SSHAuthMethodValue = SSHAuthMethod | (typeof SSH_AUTH_METHOD_ALIASES)[number]
export type SSHAuthFactor = "password" | "key" | "keyboard_interactive"
export type SSHCredentialField = "password" | "key"

export function isSSHAuthMethod(value: unknown): value is SSHAuthMethodValue {
  return typeof value === "string" && (
    SSH_AUTH_METHODS.includes(value as SSHAuthMethod) ||
    SSH_AUTH_METHOD_ALIASES.includes(value as (typeof SSH_AUTH_METHOD_ALIASES)[number])
  )
}

export function normalizeSSHAuthMethod(
  value: unknown,
  fallback: SSHAuthMethod = "password",
): SSHAuthMethod {
  if (value === "keyboard") {
    return "keyboard_interactive"
  }
  return typeof value === "string" && SSH_AUTH_METHODS.includes(value as SSHAuthMethod)
    ? value as SSHAuthMethod
    : fallback
}

export function authMethodFactors(method?: AuthMethod | string | null): SSHAuthFactor[] {
  switch (method) {
    case "password":
      return ["password"]
    case "key":
      return ["key"]
    case "password_keyboard":
      return ["password", "keyboard_interactive"]
    case "key_keyboard":
      return ["key", "keyboard_interactive"]
    case "key_password":
      return ["key", "password"]
    case "key_password_keyboard":
      return ["key", "password", "keyboard_interactive"]
    case "password_key":
      return ["password", "key"]
    case "password_key_keyboard":
      return ["password", "key", "keyboard_interactive"]
    case "keyboard_interactive":
    case "keyboard":
      return ["keyboard_interactive"]
    default:
      return []
  }
}

export function authMethodCredentialFields(method?: AuthMethod | string | null): SSHCredentialField[] {
  return authMethodFactors(method).filter((factor): factor is SSHCredentialField => (
    factor === "password" || factor === "key"
  ))
}

export function requiresPassword(method?: AuthMethod | string | null) {
  return authMethodFactors(method).includes("password")
}

export function requiresPrivateKey(method?: AuthMethod | string | null) {
  return authMethodFactors(method).includes("key")
}

export function supportsKeyboardInteractive(method?: AuthMethod | string | null) {
  return authMethodFactors(method).includes("keyboard_interactive")
}

export function primaryCredentialMethod(method?: AuthMethod | string | null): "password" | "key" {
  return authMethodCredentialFields(method)[0] ?? "password"
}

export function authMethodLabelKey(method: AuthMethod | string) {
  switch (method) {
    case "password":
      return "quickFormAuthMethodPassword"
    case "key":
      return "quickFormAuthMethodPrivateKey"
    case "password_keyboard":
      return "quickFormAuthMethodPasswordKeyboard"
    case "key_keyboard":
      return "quickFormAuthMethodPrivateKeyKeyboard"
    case "key_password":
      return "quickFormAuthMethodKeyPassword"
    case "key_password_keyboard":
      return "quickFormAuthMethodKeyPasswordKeyboard"
    case "password_key":
      return "quickFormAuthMethodPasswordKey"
    case "password_key_keyboard":
      return "quickFormAuthMethodPasswordKeyKeyboard"
    case "keyboard_interactive":
    case "keyboard":
      return "quickFormAuthMethodKeyboard"
    default:
      return "quickFormAuthMethodPassword"
  }
}
