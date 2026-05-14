import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hermes', {
  // One-shot API call to Hermes REST
  api: (opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:api', opts),

  // SSE streaming
  streamStart: (opts: { path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:stream-start', opts),
  onStream: (runId: string, cb: (e: { type: string; data?: string; error?: string }) => void) => {
    const h = (_: unknown, p: { type: string; data?: string; error?: string }) => cb(p)
    ipcRenderer.on(`stream:${runId}`, h)
    return () => ipcRenderer.removeListener(`stream:${runId}`, h)
  },

  // Gateway state
  gatewayState: () => ipcRenderer.invoke('hermes:gateway-state'),
  readEnv: () => ipcRenderer.invoke('hermes:read-env'),
  enableApiServer: (apiKey?: string) => ipcRenderer.invoke('hermes:enable-api-server', apiKey),

  // Profiles
  profiles: () => ipcRenderer.invoke('hermes:profiles'),

  // Real sessions from state.db
  sessions: (limit?: number) => ipcRenderer.invoke('hermes:sessions', limit),
  sessionMessages: (sessionId: string) => ipcRenderer.invoke('hermes:session-messages', sessionId),

  // Kanban from kanban.db
  kanbanTasks: () => ipcRenderer.invoke('hermes:kanban-tasks'),
  kanbanStats: () => ipcRenderer.invoke('hermes:kanban-stats'),

  // Skills
  skills: () => ipcRenderer.invoke('hermes:skills'),

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
