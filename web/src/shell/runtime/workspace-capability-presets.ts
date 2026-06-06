import type { RuntimeWorkspaceCapabilitiesOptions } from "@/shell/runtime/runtime-workspace"

export type WorkspaceCapabilityPresetName = "webTerminal" | "webSftp" | "desktop"

export const WORKSPACE_CAPABILITY_PRESETS = {
  webTerminal: {
    defaults: {
      terminal: true,
      sftp: true,
      transfers: true,
      ai: true,
      monitor: true,
      docker: true,
      activityLog: false,
      fullscreen: true,
    },
  },
  webSftp: {
    defaults: {
      sftp: true,
      transfers: true,
      activityLog: false,
      fullscreen: true,
      crossSessionDrag: true,
    },
    overrides: {
      terminal: false,
    },
  },
  desktop: {
    defaults: {
      terminal: true,
      sftp: true,
      transfers: true,
      ai: true,
      monitor: true,
      docker: false,
      activityLog: true,
      fullscreen: true,
      crossSessionDrag: false,
    },
  },
} satisfies Record<WorkspaceCapabilityPresetName, RuntimeWorkspaceCapabilitiesOptions>
