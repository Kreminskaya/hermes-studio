import { useState, useEffect, Component, type ReactNode } from 'react'

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text-primary)' }}>
        <div style={{ fontSize: 13, color: 'var(--red, #f87171)' }}>
          Error: {this.state.error.message}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}
        >
          Try again
        </button>
      </div>
    )
    return this.props.children
  }
}
import Sidebar from './components/Sidebar'
import ChatPage from './pages/ChatPage'
import KanbanPage from './pages/KanbanPage'
import CronPage from './pages/CronPage'
import SettingsPage, { type Theme } from './pages/SettingsPage'
import SkillsPage from './pages/SkillsPage'
import SetupBanner from './components/SetupBanner'
import StatusBar from './components/StatusBar'
import LaunchOverlay from './components/LaunchOverlay'
import './styles/app.css'

export type Page = 'chat' | 'kanban' | 'cron' | 'skills' | 'settings'

export interface GatewayState {
  gateway_state: string
  active_agents: number
  pid?: number
}

export interface HermesProfile {
  name: string
  model: string
  sessionCount: number
}

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [gatewayState, setGatewayState] = useState<GatewayState | null>(null)
  const [apiReady, setApiReady] = useState<boolean | null>(null)
  const [profiles, setProfiles] = useState<HermesProfile[]>([])
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('hermes_theme') as Theme) ?? 'gray'
  )
  const [launchStatus, setLaunchStatus] = useState<'starting' | 'running' | 'error' | null>('starting')
  const [launchDetail, setLaunchDetail] = useState<string>('Starting Hermes...')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('hermes_theme', theme)
  }, [theme])

  useEffect(() => {
    const unsubLaunch = window.hermes?.onLaunchStatus?.((s) => {
      setLaunchStatus(s.status as any)
      if (s.detail) setLaunchDetail(s.detail)
      if (s.status === 'running') {
        loadInitialState()
      }
    })

    const unsubGateway = window.hermes?.onGatewayState?.((raw) => {
      try { setGatewayState(JSON.parse(raw)) } catch {}
    })

    // Fallback: if main never sends launch-status (e.g. already running before window loaded)
    setTimeout(async () => {
      const res = await window.hermes?.checkRunning?.()
      if (res?.running) {
        setLaunchStatus('running')
        loadInitialState()
      }
    }, 4000)

    return () => { unsubLaunch?.(); unsubGateway?.() }
  }, [])

  async function loadInitialState() {
    const [state, profs] = await Promise.all([
      window.hermes?.gatewayState?.(),
      window.hermes?.profiles?.(),
    ])
    setGatewayState(state ?? null)
    setProfiles(profs ?? [])
    checkApiReady()
  }

  async function checkApiReady() {
    const res = await window.hermes?.api?.({ path: '/health' })
    setApiReady(res?.ok === true)
  }

  const showOverlay = launchStatus === 'starting' || launchStatus === 'error'

  return (
    <div className="app-shell">
      <div className="titlebar" />
      {showOverlay && (
        <LaunchOverlay
          status={launchStatus!}
          detail={launchDetail}
          onRetry={async () => {
            setLaunchStatus('starting')
            setLaunchDetail('Retrying...')
            await window.hermes?.restart?.()
          }}
        />
      )}
      <div className="app-body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          gatewayState={gatewayState}
          profiles={profiles}
          theme={theme}
        />
        <main className="main-content">
          {apiReady === false && (
            <SetupBanner onEnabled={() => { setApiReady(true); checkApiReady() }} />
          )}
          <PageErrorBoundary>
            <div style={{ display: page === 'chat'     ? 'contents' : 'none' }}><ChatPage apiReady={apiReady === true} /></div>
            <div style={{ display: page === 'kanban'   ? 'contents' : 'none' }}><KanbanPage /></div>
            <div style={{ display: page === 'cron'     ? 'contents' : 'none' }}><CronPage /></div>
            <div style={{ display: page === 'skills'   ? 'contents' : 'none' }}><SkillsPage /></div>
            <div style={{ display: page === 'settings' ? 'contents' : 'none' }}><SettingsPage theme={theme} onTheme={setTheme} /></div>
          </PageErrorBoundary>
        </main>
      </div>
      <StatusBar gatewayState={gatewayState} apiReady={apiReady === true} />
    </div>
  )
}

declare global {
  interface Window {
    hermes: {
      api:            (opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }>
      streamStart:    (opts: { path: string; body?: unknown; headers?: Record<string, string> }) => Promise<string>
      streamStop:     (runId: string) => Promise<void>
      onStream:       (runId: string, cb: (e: { type: string; data?: string; error?: string }) => void) => () => void
      showFilePicker: () => Promise<{ type: string; name: string; mime: string; data: string; path: string } | null>
      gatewayState:   () => Promise<GatewayState | null>
      readEnv:        () => Promise<Record<string, string>>
      enableApiServer:(apiKey?: string) => Promise<{ ok: boolean; error?: string }>
      profiles:       () => Promise<HermesProfile[]>
      sessions:       (limit?: number) => Promise<HermesSession[]>
      sessionMessages:(sessionId: string) => Promise<HermesMessage[]>
      kanbanTasks:    () => Promise<KanbanTask[]>
      kanbanStats:    () => Promise<KanbanStat[]>
      checkRunning:   () => Promise<{ running: boolean }>
      skills:         () => Promise<{ category: string; name: string; description: string; tags: string[]; version: string }[]>
      restart:        () => Promise<{ ok: boolean }>
      onLaunchStatus: (cb: (s: { status: string; detail?: string }) => void) => () => void
      onGatewayState: (cb: (raw: string) => void) => () => void
      onKanbanRefresh:(cb: () => void) => () => void
      onSessionsRefresh:(cb: () => void) => () => void
    }
  }
}

export interface HermesSession {
  id: string
  title: string | null
  started_at: number
  ended_at: number | null
  message_count: number
  tool_call_count: number
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number | null
  actual_cost_usd: number | null
  model: string | null
}

export interface HermesMessage {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_name: string | null
  tool_calls: string | null
  timestamp: number
  token_count: number | null
}

export interface KanbanTask {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: string
  priority: number
  created_at: number | null
  started_at: number | null
  completed_at: number | null
  worker_pid: number | null
  consecutive_failures: number
  last_failure_error: string | null
  run_profile: string | null
  run_status: string | null
  outcome: string | null
  run_started_at: number | null
  run_ended_at: number | null
}

export interface KanbanStat {
  status: string
  assignee: string | null
  count: number
}
