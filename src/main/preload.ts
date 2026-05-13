import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hermes', {
  // One-shot API call
  api: (opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:api', opts),

  // Start SSE stream, returns runId
  streamStart: (opts: { path: string; body?: unknown; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('hermes:stream-start', opts),

  // Subscribe to SSE chunks for a runId
  onStream: (runId: string, cb: (event: { type: string; data?: string; error?: string }) => void) => {
    const handler = (_: unknown, payload: { type: string; data?: string; error?: string }) => cb(payload)
    ipcRenderer.on(`stream:${runId}`, handler)
    return () => ipcRenderer.removeListener(`stream:${runId}`, handler)
  },

  // Read Hermes local state
  gatewayState: () => ipcRenderer.invoke('hermes:gateway-state'),
  kanbanStatus: () => ipcRenderer.invoke('hermes:kanban-status'),
  readEnv: () => ipcRenderer.invoke('hermes:read-env'),
  enableApiServer: (apiKey?: string) => ipcRenderer.invoke('hermes:enable-api-server', apiKey),

  // Watch for file changes pushed from main
  onGatewayState: (cb: (raw: string) => void) => {
    ipcRenderer.on('gateway:state', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('gateway:state')
  },
  onKanbanStatus: (cb: (raw: string) => void) => {
    ipcRenderer.on('kanban:status', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('kanban:status')
  },
})
