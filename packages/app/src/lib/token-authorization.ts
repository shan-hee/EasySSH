import type { Action, GrantInput } from "@/lib/api/grants"
import type { Script } from "@/lib/script-types"
import type { Server } from "@/lib/server-types"

export type TokenPermissions = {
  actions: Action[]
  allow_interactive: boolean
  scripts: NonNullable<GrantInput["resources"][number]["scripts"]>
}

export const tokenPresets = {
  inspect: ["monitor.read", "docker.read", "files.list", "files.read"],
  files: ["files.list", "files.read", "files.download", "files.upload", "files.write"],
  scripts: ["monitor.read", "scripts.execute"],
  operations: ["terminal.connect", "monitor.read", "docker.read", "files.list", "files.read", "files.write"],
  custom: [],
} satisfies Record<string, Action[]>

export type TokenPreset = keyof typeof tokenPresets
// One permission set applies to every selected server; tokens that need
// different permissions per server are created separately.
export type TokenAuthorizationDraft = {
  preset: TokenPreset
  permissions: TokenPermissions
  serverIds: string[]
}

export const tokenResourceLimit = 100
export const tokenActions: Action[] = [
  "monitor.read", "files.list", "files.read", "files.download", "files.upload",
  "files.write", "files.delete", "scripts.execute", "terminal.connect",
  "docker.read", "docker.manage", "vnc.connect", "rdp.connect",
]

export function presetPermissions(preset: TokenPreset): TokenPermissions {
  return { actions: [...tokenPresets[preset]], allow_interactive: false, scripts: [] }
}

export function newTokenAuthorization(): TokenAuthorizationDraft {
  return { preset: "inspect", permissions: presetPermissions("inspect"), serverIds: [] }
}

// Groups are expanded when selected in the editor, never stored as a dynamic
// grant. Newly added servers therefore cannot inherit an existing token.
export function tokenResources(draft: TokenAuthorizationDraft): GrantInput["resources"] {
  const { actions, allow_interactive, scripts } = draft.permissions
  return draft.serverIds.map(server_id => ({
    server_id,
    actions: [...actions],
    allow_interactive,
    scripts: actions.includes("scripts.execute") ? structuredClone(scripts) : [],
  }))
}

export function tokenAuthorizationIssue(draft: TokenAuthorizationDraft, servers: Server[], scripts: Script[]) {
  const { actions } = draft.permissions
  if (!actions.length) return "selectPermissions"
  if (actions.includes("scripts.execute")) {
    if (!draft.permissions.scripts.length) return "selectScripts"
    for (const allowed of draft.permissions.scripts) {
      if (!scripts.some(script => script.id === allowed.script_id && script.version === allowed.version)) return "scriptChanged"
      for (const [name, rule] of Object.entries(allowed.parameters ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !Number.isInteger(rule.max_bytes) || rule.max_bytes < 1 || rule.max_bytes > 4096) return "invalidParameters"
      }
    }
  }
  if (!draft.serverIds.length) return "selectServers"
  if (draft.serverIds.length > tokenResourceLimit) return "tooManyServers"
  const available = new Set(servers.map(server => server.id))
  if (draft.serverIds.some(serverId => !available.has(serverId))) return "serverUnavailable"
  return null
}
