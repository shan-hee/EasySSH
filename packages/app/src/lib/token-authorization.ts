import type { Action, GrantDetail, GrantInput } from "@/lib/api/grants"
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

const sameActions = (a: Action[], b: Action[]) => a.length === b.length && a.every(action => b.includes(action))

// Tokens apply one permission set to every server. A grant changed through the
// API may differ per server; the editor then starts from the first server's set,
// and saving applies it to all of them.
export function draftFromGrant(detail: GrantDetail): { draft: TokenAuthorizationDraft; uniform: boolean } {
  const [first] = detail.resources
  const actions = first?.actions ?? []
  const allow_interactive = first?.allow_interactive ?? false
  const scriptsOf = (serverId: string) => detail.scripts
    .filter(script => script.server_id === serverId)
    .map(({ script_id, version, parameters }) => ({ script_id, version, parameters }))
  const scripts = first ? scriptsOf(first.id) : []
  const preset = (Object.keys(tokenPresets) as TokenPreset[])
    .find(name => name !== "custom" && sameActions(tokenPresets[name], actions)) ?? "custom"
  const uniform = detail.resources.every(resource => sameActions(resource.actions, actions)
    && (resource.allow_interactive ?? false) === allow_interactive
    && JSON.stringify(scriptsOf(resource.id)) === JSON.stringify(scripts))
  return {
    draft: { preset, permissions: { actions: [...actions], allow_interactive, scripts }, serverIds: detail.resources.map(resource => resource.id) },
    uniform,
  }
}
