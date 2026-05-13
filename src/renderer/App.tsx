import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ChatPage from './pages/ChatPage'
import KanbanPage from './pages/KanbanPage'
import CronPage from './pages/CronPage'
import SetupBanner from './components/SetupBanner'
import StatusBar from './components/StatusBar'
import './styles/app.css'

export type Page = 'chat' | 'kanban' | 'cron'

export interface GatewayState {
  gateway_state: string
  active_agents: number
  pid?: number
}

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [gatewayState, setGatewayState] = useState<GatewayState | null>(null)
  const [apiReady, setApiReady] = useState<boolean | null>(null)

  useEffect(() => {
    loadGatewayState()

    // Watch for live updates from main process
    const unsub = window.hermes?.onGatewayState?.((raw) => {
      try { setGatewayState(JSON.parse(raw)) } catch {}
    })
    return () => unsub?.()
  }, [])

  async function loadGatewayState() {
    const state = await window.hermes?.gatewayState?.()
    setGatewayState(state)
    checkApiReady()
  }

  async function checkApiReady() {
    const res = await window.hermes?.api?.({ path: '/health' })
    setApiReady(res?.ok === true)
  }

  return (
    <div className="app-shell">
      <div className="titlebar" />
      <div className="app-body">
        <Sidebar page={page} onNavigate={setPage} gatewayState={gatewayState} />
        <main className="main-content">
          {apiReady === false && (
            <SetupBanner onEnabled={() => setApiReady(true)} />
          )}
          {page === 'chat'   && <ChatPage apiReady={apiReady === true} />}
          {page === 'kanban' && <KanbanPage />}
          {page === 'cron'   && <CronPage />}
        </main>
      </div>
      <StatusBar gatewayState={gatewayState} apiReady={apiReady === true} />
    </div>
  )
}

// Electron bridge type (available after contextBridge.exposeInMainWorld)
declare global {
  interface Window {
    hermes: {
      api: (opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }>
      streamStart: (opts: { path: string; body?: unknown; headers?: Record<string, string> }) => Promise<string>
      onStream: (runId: string, cb: (e: { type: string; data?: string; error?: string }) => void) => () => void
      gatewayState: () => Promise<GatewayState | null>
      kanbanStatus: () => Promise<string>
      readEnv: () => Promise<Record<string, string>>
      enableApiServer: (apiKey?: string) => Promise<{ ok: boolean; error?: string }>
      onGatewayState: (cb: (raw: string) => void) => () => void
      onKanbanStatus: (cb: (raw: string) => void) => () => void
    }
  }
}
