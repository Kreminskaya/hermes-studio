import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hermes', {
  // One-shot API call to Hermes REST
  api: (opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:api', opts),

  // SSE streaming
  streamStart: (opts: { path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:stream-start', opts),
  streamStop: (runId: string) =>
    ipcRenderer.invoke('hermes:stream-stop', runId),
  onStream: (runId: string, cb: (e: { type: string; data?: string; error?: string }) => void) => {
    const h = (_: unknown, p: { type: string; data?: string; error?: string }) => cb(p)
    ipcRenderer.on(`stream:${runId}`, h)
    return () => ipcRenderer.removeListener(`stream:${runId}`, h)
  },

  // File picker
  showFilePicker: () => ipcRenderer.invoke('hermes:show-file-picker'),

  // Gateway state
  gatewayState: () => ipcRenderer.invoke('hermes:gateway-state'),
  readEnv: () => ipcRenderer.invoke('hermes:read-env'),
  enableApiServer: (apiKey?: string) => ipcRenderer.invoke('hermes:enable-api-server', apiKey),

  // Profiles
  profiles: () => ipcRenderer.invoke('hermes:profiles'),

  // Real sessions from state.db
  sessions: (limit?: number) => ipcRenderer.invoke('hermes:sessions', limit),
  sessionsHistory: (limit?: number) => ipcRenderer.invoke('hermes:sessions-history', limit),
  sessionMessages: (sessionId: string) => ipcRenderer.invoke('hermes:session-messages', sessionId),

  // Kanban from kanban.db
  kanbanTasks: () => ipcRenderer.invoke('hermes:kanban-tasks'),
  kanbanStats: () => ipcRenderer.invoke('hermes:kanban-stats'),

  // Skills
  skills: () => ipcRenderer.invoke('hermes:skills'),
  skillToggle: (name: string, enable: boolean) => ipcRenderer.invoke('hermes:skill-toggle', name, enable),

  // Insights (usage analytics from state.db) + Hermes version/update awareness
  insights: () => ipcRenderer.invoke('hermes:insights'),
  hermesVersion: () => ipcRenderer.invoke('hermes:hermes-version'),

  // Update flow
  updateCheck: () => ipcRenderer.invoke('hermes:update-check'),
  updateRun: () => ipcRenderer.invoke('hermes:update-run'),
  onUpdateProgress: (cb: (e: { line: string }) => void) => {
    const h = (_: unknown, p: { line: string }) => cb(p)
    ipcRenderer.on('hermes:update-progress', h)
    return () => ipcRenderer.removeListener('hermes:update-progress', h)
  },
  onUpdateDone: (cb: (e: { ok: boolean; code?: number; error?: string }) => void) => {
    const h = (_: unknown, p: { ok: boolean; code?: number; error?: string }) => cb(p)
    ipcRenderer.on('hermes:update-done', h)
    return () => ipcRenderer.removeListener('hermes:update-done', h)
  },

  // Notifications
  setNotifications: (enabled: boolean) => ipcRenderer.invoke('hermes:set-notifications', enabled),
  testNotification: () => ipcRenderer.invoke('hermes:test-notification'),

  // Navigation pushed from main (e.g. clicking a notification)
  onNavigate: (cb: (page: string) => void) => {
    const h = (_: unknown, page: string) => cb(page)
    ipcRenderer.on('navigate', h)
    return () => ipcRenderer.removeListener('navigate', h)
  },

  // Hermes process control
  checkRunning: () => ipcRenderer.invoke('hermes:check-running'),
  restart: () => ipcRenderer.invoke('hermes:restart'),

  // Push events from main
  onLaunchStatus: (cb: (s: { status: string; detail?: string }) => void) => {
    const h = (_: unknown, p: { status: string; detail?: string }) => cb(p)
    ipcRenderer.on('hermes:launch-status', h)
    return () => ipcRenderer.removeListener('hermes:launch-status', h)
  },
  onGatewayState: (cb: (raw: string) => void) => {
    ipcRenderer.on('gateway:state', (_, d) => cb(d))
    return () => ipcRenderer.removeAllListeners('gateway:state')
  },
  onKanbanRefresh: (cb: () => void) => {
    ipcRenderer.on('kanban:refresh', cb)
    return () => ipcRenderer.removeAllListeners('kanban:refresh')
  },
  onSessionsRefresh: (cb: () => void) => {
    ipcRenderer.on('sessions:refresh', cb)
    return () => ipcRenderer.removeAllListeners('sessions:refresh')
  },
})
