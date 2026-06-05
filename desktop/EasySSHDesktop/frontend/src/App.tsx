import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopServerAuthMethod,
  DesktopServerService,
  DesktopService,
} from '../bindings/github.com/easyssh/easyssh-desktop'
import type {
  DesktopRuntimeInfo,
  DesktopServer,
  DesktopServerCommandResult,
  DesktopServerInput,
} from '../bindings/github.com/easyssh/easyssh-desktop'

type ThemeMode = 'dark' | 'light'
type ViewMode = 'list' | 'grid'
type TerminalPanel = 'terminal' | 'files' | 'monitor' | 'docker' | 'ai'

type TerminalLine = {
  id: string
  kind: 'input' | 'output' | 'error' | 'system'
  text: string
}

type AppSession = {
  id: string
  type: 'config' | 'terminal'
  title: string
  server?: DesktopServer
  activePanel: TerminalPanel
  lines: TerminalLine[]
  command: string
  running: boolean
}

type ServerFormState = {
  name: string
  host: string
  port: string
  username: string
  authMethod: DesktopServerAuthMethod
  password: string
  privateKey: string
  group: string
  tags: string
  description: string
}

type ToastState = {
  tone: 'success' | 'error' | 'info'
  message: string
} | null

const preferenceKeys = {
  theme: 'easyssh.desktop.theme',
  viewMode: 'easyssh.desktop.connection.viewMode',
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const readPreference = <T extends string>(key: string, fallback: T, allowed: readonly T[]) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key) as T | null
  return value && allowed.includes(value) ? value : fallback
}

const emptyServerForm: ServerFormState = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: DesktopServerAuthMethod.DesktopServerAuthPassword,
  password: '',
  privateKey: '',
  group: '',
  tags: '',
  description: '',
}

const createConfigSession = (): AppSession => ({
  id: createId('config'),
  type: 'config',
  title: '连接配置',
  activePanel: 'terminal',
  lines: [],
  command: '',
  running: false,
})

const createTerminalSession = (server: DesktopServer): AppSession => ({
  id: createId('terminal'),
  type: 'terminal',
  title: server.name || server.host,
  server,
  activePanel: 'terminal',
  command: '',
  running: false,
  lines: [
    {
      id: createId('line'),
      kind: 'system',
      text: `Connected target ${server.username}@${server.host}:${server.port}`,
    },
  ],
})

const serverToForm = (server: DesktopServer): ServerFormState => ({
  name: server.name || '',
  host: server.host,
  port: String(server.port || 22),
  username: server.username,
  authMethod: server.auth_method || DesktopServerAuthMethod.DesktopServerAuthPassword,
  password: server.password || '',
  privateKey: server.private_key || '',
  group: server.group || '',
  tags: (server.tags || []).join(', '),
  description: server.description || '',
})

const formToInput = (form: ServerFormState): DesktopServerInput => ({
  name: form.name.trim(),
  host: form.host.trim(),
  port: Number.parseInt(form.port, 10) || 22,
  username: form.username.trim(),
  auth_method: form.authMethod,
  password: form.password,
  private_key: form.privateKey,
  group: form.group.trim(),
  tags: form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),
  description: form.description.trim(),
})

const formatTime = (value?: string) => {
  if (!value) return 'never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const getServerLabel = (server: DesktopServer) => server.name || server.host

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => readPreference(preferenceKeys.theme, 'dark', ['dark', 'light']))
  const [viewMode, setViewMode] = useState<ViewMode>(() => readPreference(preferenceKeys.viewMode, 'list', ['list', 'grid']))
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null)
  const [servers, setServers] = useState<DesktopServer[]>([])
  const [loadingServers, setLoadingServers] = useState(true)
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState('all')
  const [sessions, setSessions] = useState<AppSession[]>(() => [createConfigSession()])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<DesktopServer | null>(null)
  const [serverForm, setServerForm] = useState<ServerFormState>(emptyServerForm)
  const [toast, setToast] = useState<ToastState>(null)
  const [activityTotal, setActivityTotal] = useState(0)

  useEffect(() => {
    setActiveSessionId((current) => (
      current && sessions.some((session) => session.id === current)
        ? current
        : sessions[0]?.id || ''
    ))
  }, [sessions])

  useEffect(() => {
    window.localStorage.setItem(preferenceKeys.theme, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem(preferenceKeys.viewMode, viewMode)
  }, [viewMode])

  useEffect(() => {
    DesktopService.RuntimeInfo()
      .then(setRuntime)
      .catch((error) => setToast({ tone: 'error', message: getErrorMessage(error, '运行时信息读取失败') }))
  }, [])

  const loadServers = useCallback(async () => {
    try {
      setLoadingServers(true)
      const result = await DesktopServerService.List({ page: 1, limit: 500 })
      setServers(result.data || [])
    } catch (error) {
      setToast({ tone: 'error', message: getErrorMessage(error, '连接配置读取失败') })
    } finally {
      setLoadingServers(false)
    }
  }, [])

  const loadActivityCount = useCallback(async () => {
    try {
      const stats = await ActivityLogService.GetStatistics({})
      setActivityTotal(stats.total || 0)
    } catch {
      setActivityTotal(0)
    }
  }, [])

  useEffect(() => {
    void loadServers()
    void loadActivityCount()
  }, [loadActivityCount, loadServers])

  const recordActivity = useCallback(async (
    action: string,
    resource: string,
    status: DesktopActivityLogStatus = DesktopActivityLogStatus.DesktopActivityLogSuccess,
    detail = '',
    serverId = '',
  ) => {
    try {
      await ActivityLogService.Record({ action, resource, status, detail, serverId })
      void loadActivityCount()
    } catch {
      // Activity logging is best effort in the desktop shell.
    }
  }, [loadActivityCount])

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    servers.forEach((server) => {
      const group = server.group?.trim()
      if (!group) return
      counts.set(group, (counts.get(group) || 0) + 1)
    })
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
  }, [servers])

  const filteredServers = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return servers.filter((server) => {
      if (activeGroup !== 'all' && (server.group || '') !== activeGroup) return false
      if (!keyword) return true
      const tags = (server.tags || []).join(' ')
      return [server.name, server.host, server.username, server.description, server.group, tags]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [activeGroup, search, servers])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [activeSessionId, sessions],
  )

  const openCreateForm = () => {
    setEditingServer(null)
    setServerForm(emptyServerForm)
    setFormOpen(true)
  }

  const openEditForm = (server: DesktopServer) => {
    setEditingServer(server)
    setServerForm(serverToForm(server))
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingServer(null)
    setServerForm(emptyServerForm)
  }

  const saveServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = formToInput(serverForm)
    if (!input.host || !input.username) {
      setToast({ tone: 'error', message: '主机和用户名不能为空' })
      return
    }

    try {
      if (editingServer) {
        const updated = await DesktopServerService.Update(editingServer.id, input)
        setServers((current) => current.map((server) => (server.id === updated.id ? updated : server)))
        setSessions((current) => current.map((session) => (
          session.server?.id === updated.id
            ? { ...session, title: getServerLabel(updated), server: updated }
            : session
        )))
        await recordActivity('server_update', getServerLabel(updated), DesktopActivityLogStatus.DesktopActivityLogSuccess, 'Desktop server updated', updated.id)
        setToast({ tone: 'success', message: '连接配置已更新' })
      } else {
        const created = await DesktopServerService.Create(input)
        setServers((current) => [...current, created])
        await recordActivity('server_create', getServerLabel(created), DesktopActivityLogStatus.DesktopActivityLogSuccess, 'Desktop server created', created.id)
        setToast({ tone: 'success', message: '连接配置已保存' })
      }
      closeForm()
    } catch (error) {
      setToast({ tone: 'error', message: getErrorMessage(error, '连接配置保存失败') })
    }
  }

  const deleteServer = async (server: DesktopServer) => {
    if (!window.confirm(`删除连接配置 ${getServerLabel(server)}？`)) return

    try {
      await DesktopServerService.Delete(server.id)
      setServers((current) => current.filter((item) => item.id !== server.id))
      setSessions((current) => current.map((session) => (
        session.server?.id === server.id
          ? { ...createConfigSession(), id: session.id }
          : session
      )))
      await recordActivity('server_delete', getServerLabel(server), DesktopActivityLogStatus.DesktopActivityLogWarning, 'Desktop server deleted', server.id)
      setToast({ tone: 'success', message: '连接配置已删除' })
    } catch (error) {
      setToast({ tone: 'error', message: getErrorMessage(error, '连接配置删除失败') })
    }
  }

  const moveServer = async (serverId: string, direction: -1 | 1) => {
    const currentIndex = servers.findIndex((server) => server.id === serverId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= servers.length) return

    const nextServers = [...servers]
    const [item] = nextServers.splice(currentIndex, 1)
    nextServers.splice(nextIndex, 0, item)
    setServers(nextServers)

    try {
      await DesktopServerService.Reorder(nextServers.map((server) => server.id))
    } catch (error) {
      setToast({ tone: 'error', message: getErrorMessage(error, '排序保存失败') })
      void loadServers()
    }
  }

  const newConfigTab = () => {
    const next = createConfigSession()
    setSessions((current) => [...current, next])
    setActiveSessionId(next.id)
  }

  const connectServer = async (server: DesktopServer) => {
    try {
      const probe = await DesktopServerService.ExecuteCommand({ serverId: server.id, command: 'echo EasySSH', timeoutMs: 15000 })
      if (probe.exitCode !== 0) {
        throw new Error(probe.output || `SSH probe exited with ${probe.exitCode}`)
      }

      const connectedServer = await DesktopServerService.MarkConnected(server.id)
      setServers((current) => current.map((item) => (item.id === connectedServer.id ? connectedServer : item)))
      const nextSession = createTerminalSession(connectedServer)
      const targetConfigSessionId = activeSession?.type === 'config' ? activeSession.id : null

      if (targetConfigSessionId) {
        setSessions((current) => current.map((session) => (
          session.id === targetConfigSessionId
            ? { ...nextSession, id: session.id }
            : session
        )))
        setActiveSessionId(targetConfigSessionId)
      } else {
        setSessions((current) => [...current, nextSession])
        setActiveSessionId(nextSession.id)
      }
      await recordActivity('ssh_connect', `${connectedServer.username}@${connectedServer.host}`, DesktopActivityLogStatus.DesktopActivityLogSuccess, 'Desktop terminal session opened', connectedServer.id)
      setToast({ tone: 'success', message: `已打开 ${getServerLabel(connectedServer)}` })
    } catch (error) {
      setToast({ tone: 'error', message: getErrorMessage(error, '连接打开失败') })
    }
  }

  const closeSession = (sessionId: string) => {
    const remainingSessions = sessions.filter((session) => session.id !== sessionId)
    if (remainingSessions.length === 0) {
      const nextSession = createConfigSession()
      setSessions([nextSession])
      setActiveSessionId(nextSession.id)
      return
    }

    setSessions(remainingSessions)
    if (sessionId === activeSessionId) {
      setActiveSessionId(remainingSessions[0]?.id || '')
    }
  }

  const updateSession = (sessionId: string, updater: (session: AppSession) => AppSession) => {
    setSessions((current) => current.map((session) => (session.id === sessionId ? updater(session) : session)))
  }

  const runCommand = async (session: AppSession) => {
    const command = session.command.trim()
    if (!session.server || !command || session.running) return

    updateSession(session.id, (current) => ({
      ...current,
      command: '',
      running: true,
      lines: [
        ...current.lines,
        { id: createId('line'), kind: 'input', text: `$ ${command}` },
        { id: createId('line'), kind: 'system', text: 'running...' },
      ],
    }))

    try {
      const result = await DesktopServerService.ExecuteCommand({ serverId: session.server.id, command, timeoutMs: 60000 })
      updateSession(session.id, (current) => ({
        ...current,
        running: false,
        lines: replaceRunningLine(current.lines, result),
      }))
      await recordActivity(
        'ssh_command',
        command,
        result.exitCode === 0 ? DesktopActivityLogStatus.DesktopActivityLogSuccess : DesktopActivityLogStatus.DesktopActivityLogWarning,
        `exit ${result.exitCode}, ${result.durationMs}ms`,
        session.server.id,
      )
    } catch (error) {
      updateSession(session.id, (current) => ({
        ...current,
        running: false,
        lines: replaceRunningLineWithError(current.lines, getErrorMessage(error, 'command failed')),
      }))
      await recordActivity('ssh_command', command, DesktopActivityLogStatus.DesktopActivityLogFailure, getErrorMessage(error, 'command failed'), session.server.id)
    }
  }

  const connectedSessions = sessions.filter((session) => session.type === 'terminal').length

  return (
    <main className={`desktop-shell terminal-config-shell theme-${theme}`}>
      <header className="desktop-topbar">
        <div className="brand-block">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-title">EasySSH</div>
            <div className="brand-subtitle">Desktop Terminal</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" title="新建连接配置页" aria-label="新建连接配置页" onClick={newConfigTab}>+</button>
          <button className="icon-button" type="button" title="切换主题" aria-label="切换主题" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '○' : '●'}
          </button>
        </div>
      </header>

      <section className="terminal-workspace">
        <div className="terminal-frame">
          <div className="tabbar" role="tablist" aria-label="Terminal sessions">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`workspace-tab ${session.id === activeSessionId ? 'active' : ''}`}
              >
                <button
                  className="tab-target"
                  type="button"
                  role="tab"
                  aria-selected={session.id === activeSessionId}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className={`session-dot ${session.type}`} />
                  <span>{session.title}</span>
                </button>
                <button
                  className="tab-close"
                  type="button"
                  title="关闭页签"
                  aria-label="关闭页签"
                  onClick={() => closeSession(session.id)}
                >×</button>
              </div>
            ))}
          </div>

          <div className="workspace-content">
            {activeSession?.type === 'terminal' ? (
              <TerminalSessionView
                session={activeSession}
                onRunCommand={() => void runCommand(activeSession)}
                onCommandChange={(command) => updateSession(activeSession.id, (current) => ({ ...current, command }))}
                onPanelChange={(activePanel) => updateSession(activeSession.id, (current) => ({ ...current, activePanel }))}
              />
            ) : (
              <ConnectionConfigView
                servers={filteredServers}
                allServers={servers}
                groups={groups}
                activeGroup={activeGroup}
                loading={loadingServers}
                search={search}
                viewMode={viewMode}
                onSearchChange={setSearch}
                onGroupChange={setActiveGroup}
                onViewModeChange={setViewMode}
                onCreate={openCreateForm}
                onEdit={openEditForm}
                onDelete={(server) => void deleteServer(server)}
                onConnect={(server) => void connectServer(server)}
                onMove={moveServer}
              />
            )}
          </div>
        </div>

        <aside className="workspace-side">
          <div className="side-section">
            <div className="side-title">状态</div>
            <div className="status-metrics">
              <div><strong>{servers.length}</strong><span>连接配置</span></div>
              <div><strong>{connectedSessions}</strong><span>终端页签</span></div>
              <div><strong>{activityTotal}</strong><span>本地记录</span></div>
            </div>
          </div>
          <div className="side-section">
            <div className="side-title">SQLite</div>
            <div className="data-path">{runtime?.dataDir || 'loading...'}</div>
          </div>
          <div className="side-section capability-list">
            <div className="side-title">能力</div>
            <span>Terminal</span>
            <span>Server Config</span>
            <span>Command Exec</span>
            <span>Activity Log</span>
          </div>
        </aside>
      </section>

      {formOpen && (
        <ServerFormDialog
          form={serverForm}
          editing={!!editingServer}
          onChange={setServerForm}
          onClose={closeForm}
          onSubmit={(event) => void saveServer(event)}
        />
      )}

      {toast && (
        <div className={`desktop-toast ${toast.tone}`} role="status">
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </main>
  )
}

function ConnectionConfigView({
  servers,
  allServers,
  groups,
  activeGroup,
  loading,
  search,
  viewMode,
  onSearchChange,
  onGroupChange,
  onViewModeChange,
  onCreate,
  onEdit,
  onDelete,
  onConnect,
  onMove,
}: {
  servers: DesktopServer[]
  allServers: DesktopServer[]
  groups: [string, number][]
  activeGroup: string
  loading: boolean
  search: string
  viewMode: ViewMode
  onSearchChange: (value: string) => void
  onGroupChange: (value: string) => void
  onViewModeChange: (value: ViewMode) => void
  onCreate: () => void
  onEdit: (server: DesktopServer) => void
  onDelete: (server: DesktopServer) => void
  onConnect: (server: DesktopServer) => void
  onMove: (serverId: string, direction: -1 | 1) => void
}) {
  return (
    <div className="connection-config-page">
      <div className="config-toolbar">
        <div className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索名称、主机、用户、标签"
          />
        </div>
        <div className="toolbar-actions">
          <div className="segmented" aria-label="视图模式">
            <button type="button" className={viewMode === 'grid' ? 'active' : ''} title="网格" aria-label="网格" onClick={() => onViewModeChange('grid')}>▦</button>
            <button type="button" className={viewMode === 'list' ? 'active' : ''} title="列表" aria-label="列表" onClick={() => onViewModeChange('list')}>☰</button>
          </div>
          <button className="primary-action compact" type="button" onClick={onCreate}>+ 添加</button>
        </div>
      </div>

      <div className="group-filter" aria-label="连接分组">
        <button className={activeGroup === 'all' ? 'active' : ''} type="button" onClick={() => onGroupChange('all')}>全部 ({allServers.length})</button>
        {groups.map(([group, count]) => (
          <button key={group} className={activeGroup === group ? 'active' : ''} type="button" onClick={() => onGroupChange(group)}>{group} ({count})</button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">正在读取本地连接配置</div>
      ) : servers.length > 0 ? (
        <div className={`server-list ${viewMode}`}>
          {servers.map((server, index) => (
            <ServerConfigItem
              key={server.id}
              server={server}
              viewMode={viewMode}
              disableMoveUp={index === 0}
              disableMoveDown={index === servers.length - 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onConnect={onConnect}
              onMove={onMove}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">▣</div>
          <strong>{allServers.length > 0 ? '没有匹配的连接配置' : '还没有连接配置'}</strong>
          <button className="primary-action compact" type="button" onClick={onCreate}>+ 添加</button>
        </div>
      )}
    </div>
  )
}

function ServerConfigItem({
  server,
  viewMode,
  disableMoveUp,
  disableMoveDown,
  onEdit,
  onDelete,
  onConnect,
  onMove,
}: {
  server: DesktopServer
  viewMode: ViewMode
  disableMoveUp: boolean
  disableMoveDown: boolean
  onEdit: (server: DesktopServer) => void
  onDelete: (server: DesktopServer) => void
  onConnect: (server: DesktopServer) => void
  onMove: (serverId: string, direction: -1 | 1) => void
}) {
  return (
    <article className={`server-item ${viewMode}`} onDoubleClick={() => onConnect(server)}>
      <div className="server-glyph" aria-hidden="true">⌘</div>
      <div className="server-main">
        <div className="server-title-row">
          <h3>{getServerLabel(server)}</h3>
          <span className={`server-status ${server.status}`}>{server.status === 'online' ? 'online' : 'offline'}</span>
        </div>
        <div className="server-address">{server.username}@{server.host}:{server.port}</div>
        {server.description && <p>{server.description}</p>}
        <div className="server-meta">
          {server.group && <span>{server.group}</span>}
          {(server.tags || []).map((tag) => <span key={tag}>{tag}</span>)}
          <span>{server.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? 'key' : 'password'}</span>
          <span>{formatTime(server.last_connected)}</span>
        </div>
      </div>
      <div className="server-actions" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" title="上移" aria-label="上移" disabled={disableMoveUp} onClick={() => onMove(server.id, -1)}>↑</button>
        <button type="button" title="下移" aria-label="下移" disabled={disableMoveDown} onClick={() => onMove(server.id, 1)}>↓</button>
        <button type="button" title="编辑" aria-label="编辑" onClick={() => onEdit(server)}>✎</button>
        <button type="button" title="删除" aria-label="删除" onClick={() => onDelete(server)}>×</button>
      </div>
    </article>
  )
}

function TerminalSessionView({
  session,
  onRunCommand,
  onCommandChange,
  onPanelChange,
}: {
  session: AppSession
  onRunCommand: () => void
  onCommandChange: (command: string) => void
  onPanelChange: (panel: TerminalPanel) => void
}) {
  const server = session.server
  if (!server) return null

  return (
    <div className="terminal-session-page">
      <div className="terminal-toolbar">
        <div className="terminal-target">
          <strong>{getServerLabel(server)}</strong>
          <span>{server.username}@{server.host}:{server.port}</span>
        </div>
        <div className="tool-buttons" aria-label="终端工具">
          {(['terminal', 'files', 'monitor', 'docker', 'ai'] as TerminalPanel[]).map((panel) => (
            <button
              key={panel}
              type="button"
              title={panelTitle(panel)}
              aria-label={panelTitle(panel)}
              className={session.activePanel === panel ? 'active' : ''}
              onClick={() => onPanelChange(panel)}
            >
              {panelIcon(panel)}
            </button>
          ))}
        </div>
      </div>
      <div className="terminal-body">
        <div className="terminal-output" aria-live="polite">
          {session.lines.map((line) => (
            <div key={line.id} className={`terminal-row ${line.kind}`}>{line.text}</div>
          ))}
        </div>
        {session.activePanel !== 'terminal' && <AuxiliaryPanel panel={session.activePanel} server={server} />}
      </div>
      <form className="command-line" onSubmit={(event) => { event.preventDefault(); onRunCommand() }}>
        <span>$</span>
        <input
          value={session.command}
          disabled={session.running}
          onChange={(event) => onCommandChange(event.target.value)}
          placeholder={session.running ? 'running...' : '输入命令并回车'}
        />
        <button type="submit" disabled={session.running || !session.command.trim()} title="执行" aria-label="执行">↵</button>
      </form>
    </div>
  )
}

function AuxiliaryPanel({ panel, server }: { panel: TerminalPanel; server: DesktopServer }) {
  const content = {
    files: ['/', '/home', '/var/log', '/tmp'],
    monitor: ['CPU  --', 'MEM  --', 'NET  --', 'DISK --'],
    docker: ['containers --', 'images --', 'compose --'],
    ai: ['context: current terminal', `target: ${server.host}`, 'mode: local desktop'],
    terminal: [],
  }[panel]

  return (
    <aside className="aux-panel">
      <div className="aux-title">{panelTitle(panel)}</div>
      {content.map((item) => <div key={item} className="aux-row">{item}</div>)}
    </aside>
  )
}

function ServerFormDialog({
  form,
  editing,
  onChange,
  onClose,
  onSubmit,
}: {
  form: ServerFormState
  editing: boolean
  onChange: (form: ServerFormState) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const patchForm = (patch: Partial<ServerFormState>) => onChange({ ...form, ...patch })

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="server-dialog" onSubmit={onSubmit}>
        <div className="dialog-header">
          <strong>{editing ? '编辑连接' : '添加连接'}</strong>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label><span>名称</span><input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} /></label>
          <label><span>主机</span><input required value={form.host} onChange={(event) => patchForm({ host: event.target.value })} /></label>
          <label><span>端口</span><input required value={form.port} inputMode="numeric" onChange={(event) => patchForm({ port: event.target.value })} /></label>
          <label><span>用户名</span><input required value={form.username} onChange={(event) => patchForm({ username: event.target.value })} /></label>
          <label><span>认证方式</span><select value={form.authMethod} onChange={(event) => patchForm({ authMethod: event.target.value as DesktopServerAuthMethod })}>
            <option value={DesktopServerAuthMethod.DesktopServerAuthPassword}>密码</option>
            <option value={DesktopServerAuthMethod.DesktopServerAuthKey}>私钥</option>
          </select></label>
          <label><span>分组</span><input value={form.group} onChange={(event) => patchForm({ group: event.target.value })} /></label>
        </div>

        <label><span>密码 / 私钥口令</span><input type="password" value={form.password} onChange={(event) => patchForm({ password: event.target.value })} /></label>
        <label><span>私钥</span><textarea value={form.privateKey} onChange={(event) => patchForm({ privateKey: event.target.value })} /></label>
        <label><span>标签</span><input value={form.tags} onChange={(event) => patchForm({ tags: event.target.value })} /></label>
        <label><span>描述</span><textarea value={form.description} onChange={(event) => patchForm({ description: event.target.value })} /></label>

        <div className="dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="submit" className="primary-action compact">保存</button>
        </div>
      </form>
    </div>
  )
}

function replaceRunningLine(lines: TerminalLine[], result: DesktopServerCommandResult): TerminalLine[] {
  const output = result.output.trim() || `(exit ${result.exitCode}, ${result.durationMs}ms)`
  const next = [...lines]
  const runningIndex = findLastRunningLineIndex(next)
  const replacement: TerminalLine = {
    id: createId('line'),
    kind: result.exitCode === 0 ? 'output' : 'error',
    text: output,
  }
  if (runningIndex >= 0) {
    next.splice(runningIndex, 1, replacement)
    return next
  }
  return [...next, replacement]
}

function replaceRunningLineWithError(lines: TerminalLine[], message: string): TerminalLine[] {
  const next = [...lines]
  const runningIndex = findLastRunningLineIndex(next)
  const replacement: TerminalLine = { id: createId('line'), kind: 'error', text: message }
  if (runningIndex >= 0) {
    next.splice(runningIndex, 1, replacement)
    return next
  }
  return [...next, replacement]
}

function findLastRunningLineIndex(lines: TerminalLine[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind === 'system' && lines[index].text === 'running...') {
      return index
    }
  }

  return -1
}

function panelTitle(panel: TerminalPanel) {
  switch (panel) {
    case 'files': return '文件'
    case 'monitor': return '监控'
    case 'docker': return 'Docker'
    case 'ai': return 'AI'
    case 'terminal':
    default: return '终端'
  }
}

function panelIcon(panel: TerminalPanel) {
  switch (panel) {
    case 'files': return '▣'
    case 'monitor': return '⌁'
    case 'docker': return '▤'
    case 'ai': return 'AI'
    case 'terminal':
    default: return '$_'
  }
}

export default App
