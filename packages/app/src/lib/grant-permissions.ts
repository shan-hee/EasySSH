import type { Action } from "@/lib/api/grants"

// Each group lists cumulative levels (level 0 grants nothing), so the editor
// can only produce combinations that are usable: writing files implies reading.
export const permissionGroups = [
  { id: "terminal", levels: [["terminal.connect"]] },
  { id: "vnc", levels: [["vnc.connect"]] },
  { id: "rdp", levels: [["rdp.connect"]] },
  { id: "monitor", levels: [["monitor.read"]] },
  { id: "scripts", levels: [["scripts.execute"]] },
  { id: "ai", levels: [["ai.use"]] },
  { id: "activity", levels: [["activity.read"]] },
  {
    id: "files",
    levels: [
      ["files.list", "files.read", "files.download"],
      ["files.list", "files.read", "files.download", "files.upload", "files.write"],
      ["files.list", "files.read", "files.download", "files.upload", "files.write", "files.delete"],
    ],
  },
  { id: "docker", levels: [["docker.read"], ["docker.read", "docker.manage"]] },
] as const satisfies readonly { id: string; levels: readonly (readonly Action[])[] }[]

export type PermissionGroup = (typeof permissionGroups)[number]

export const levelsOf = (group: PermissionGroup): readonly (readonly Action[])[] => group.levels
const groupActions = (group: PermissionGroup) => levelsOf(group)[levelsOf(group).length - 1]

/** 0 means none, n means `levels[n - 1]`, -1 an existing combination outside the levels. */
export function groupLevel(group: PermissionGroup, actions: readonly Action[]) {
  const granted = groupActions(group).filter(action => actions.includes(action))
  if (!granted.length) return 0
  const index = levelsOf(group).findIndex(level => level.length === granted.length && level.every(action => granted.includes(action)))
  return index < 0 ? -1 : index + 1
}

export function withGroupLevel(group: PermissionGroup, actions: readonly Action[], level: number): Action[] {
  const own = new Set<Action>(groupActions(group))
  return [...actions.filter(action => !own.has(action)), ...(level > 0 ? levelsOf(group)[level - 1] : [])]
}
