import { create } from "zustand"
import type { SessionSplitLayoutNode } from "@/lib/session/split-layout"
import type {
  SftpWorkspaceSession,
  SshWorkspaceSessionController,
  SshWorkspaceSessionStoreAdapter,
  SshWorkspaceSftpSessionController,
  WorkspaceSessionSnapshot,
  WorkspaceTransferTask,
} from "@/lib/session/workspace"

export type { SftpWorkspaceSession } from "@/lib/session/workspace"

type SplitLayoutUpdater =
  | SessionSplitLayoutNode
  | null
  | ((layout: SessionSplitLayoutNode | null) => SessionSplitLayoutNode | null)

const DEFAULT_CONFIG_TAB_IDS = ["sftp-config"]

interface SftpSessionStoreState {
  sessions: SftpWorkspaceSession[]
  configTabIds: string[]
  nextSessionId: number
  fullscreenSessionId: string | null
  activeSessionId: string | null
  activeId: string | null
  splitLayout: SessionSplitLayoutNode | null
  sessionsById: Record<string, SftpWorkspaceSession>

  setSessions: (updater: SftpWorkspaceSession[] | ((sessions: SftpWorkspaceSession[]) => SftpWorkspaceSession[])) => void
  setConfigTabIds: (updater: string[] | ((configTabIds: string[]) => string[])) => void
  setNextSessionId: (updater: number | ((value: number) => number)) => void
  setFullscreenSessionId: (sessionId: string | null | ((value: string | null) => string | null)) => void
  setActiveSessionId: (sessionId: string | null | ((value: string | null) => string | null)) => void
  setActiveId: (sessionId: string | null | ((value: string | null) => string | null)) => void
  setSplitLayout: (updater: SplitLayoutUpdater) => void
  resetWorkspaceState: () => void
}

const toLookup = (sessions: SftpWorkspaceSession[]) =>
  sessions.reduce<Record<string, SftpWorkspaceSession>>((acc, session) => {
    acc[session.id] = session
    return acc
  }, {})

export const useSftpSessionStore = create<SftpSessionStoreState>((set) => ({
  sessions: [],
  configTabIds: DEFAULT_CONFIG_TAB_IDS,
  nextSessionId: 1,
  fullscreenSessionId: null,
  activeSessionId: null,
  activeId: null,
  splitLayout: null,
  sessionsById: {},

  setSessions: (updater) => {
    set((state) => {
      const sessions = typeof updater === "function" ? updater(state.sessions) : updater
      return {
        sessions,
        sessionsById: toLookup(sessions),
      }
    })
  },

  setConfigTabIds: (updater) => {
    set((state) => ({
      configTabIds: typeof updater === "function" ? updater(state.configTabIds) : updater,
    }))
  },

  setNextSessionId: (updater) => {
    set((state) => ({
      nextSessionId: typeof updater === "function" ? updater(state.nextSessionId) : updater,
    }))
  },

  setFullscreenSessionId: (updater) => {
    set((state) => ({
      fullscreenSessionId: typeof updater === "function" ? updater(state.fullscreenSessionId) : updater,
    }))
  },

  setActiveSessionId: (updater) => {
    set((state) => ({
      activeSessionId: typeof updater === "function" ? updater(state.activeSessionId) : updater,
    }))
  },

  setActiveId: (updater) => {
    set((state) => ({
      activeId: typeof updater === "function" ? updater(state.activeId) : updater,
    }))
  },

  setSplitLayout: (updater) => {
    set((state) => ({
      splitLayout: typeof updater === "function" ? updater(state.splitLayout) : updater,
    }))
  },

  resetWorkspaceState: () => {
    set({
      sessions: [],
      configTabIds: DEFAULT_CONFIG_TAB_IDS,
      nextSessionId: 1,
      fullscreenSessionId: null,
      activeSessionId: null,
      activeId: null,
      splitLayout: null,
      sessionsById: {},
    })
  },
}))

export function createSftpWorkspaceSessionStoreAdapter(
  getTransferTasks: () => WorkspaceTransferTask[] = () => [],
): SshWorkspaceSessionStoreAdapter {
  return {
    getSnapshot: (): WorkspaceSessionSnapshot => {
      const state = useSftpSessionStore.getState()
      return {
        terminalSessions: [],
        sftpSessions: state.sessions,
        transferTasks: getTransferTasks(),
        activeSessionId: state.activeSessionId,
      }
    },
    subscribe: (listener: (snapshot: WorkspaceSessionSnapshot) => void) => (
      useSftpSessionStore.subscribe((state) => {
        listener({
          terminalSessions: [],
          sftpSessions: state.sessions,
          transferTasks: getTransferTasks(),
          activeSessionId: state.activeSessionId,
        })
      })
    ),
  }
}

export function createSftpWorkspaceSessionController(): SshWorkspaceSftpSessionController {
  return {
    getSessions: () => useSftpSessionStore.getState().sessions,
    getActiveSessionId: () => useSftpSessionStore.getState().activeSessionId,
    setSessions: (updater) => {
      useSftpSessionStore.getState().setSessions(updater)
    },
    addSession: (session) => {
      useSftpSessionStore.getState().setSessions((sessions) => [...sessions, session])
    },
    updateSession: (sessionId, update) => {
      useSftpSessionStore.getState().setSessions((sessions) => sessions.map((session) => (
        session.id === sessionId
          ? { ...session, ...update }
          : session
      )))
    },
    activateSession: (sessionId) => {
      useSftpSessionStore.getState().setActiveSessionId(sessionId)
    },
    closeSession: (sessionId) => {
      const state = useSftpSessionStore.getState()
      state.setSessions((sessions) => sessions.filter((session) => session.id !== sessionId))
      state.setActiveSessionId((activeSessionId) => activeSessionId === sessionId ? null : activeSessionId)
      state.setFullscreenSessionId((fullscreenSessionId) => fullscreenSessionId === sessionId ? null : fullscreenSessionId)
    },
    setFullscreenSession: (sessionId) => {
      useSftpSessionStore.getState().setFullscreenSessionId(sessionId)
    },
    reset: () => {
      useSftpSessionStore.getState().resetWorkspaceState()
    },
  }
}

export function createSftpWorkspaceSessionControllerAdapter(): SshWorkspaceSessionController {
  return {
    sftp: createSftpWorkspaceSessionController(),
    resetAll: () => useSftpSessionStore.getState().resetWorkspaceState(),
  }
}
