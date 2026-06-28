import type { Page, GatewayState, HermesProfile, HermesVersion } from '../App'
import type { Theme } from '../pages/SettingsPage'
import './Sidebar.css'

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  gatewayState: GatewayState | null
  profiles: HermesProfile[]
  theme: Theme
  version: HermesVersion | null
}

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: '💬' },
  { id: 'history',  label: 'History',  icon: '🕘' },
  { id: 'kanban',   label: 'Kanban',   icon: '📋' },
  { id: 'insights', label: 'Insights', icon: '📊' },
  { id: 'cron',     label: 'Cron',     icon: '⏰' },
  { id: 'skills',   label: 'Skills',   icon: '✨' },
]

const THEME_ICONS: Record<Theme, string> = {
  dark:  '🌑',
  light: '☀️',
  gray:  '🟢',
}

function shortModel(model: string): string {
  // Trim long model strings to fit sidebar
  if (model.length <= 18) return model
  const parts = model.split('/')
  return parts[parts.length - 1].slice(0, 18)
}

export default function Sidebar({ page, onNavigate, gatewayState, profiles, theme, version }: Props) {
  const running = gatewayState?.gateway_state === 'running'
  const agents  = gatewayState?.active_agents ?? 0

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">H</span>
        <span className="logo-text">Hermes Studio</span>
      </div>

      <div className="sidebar-status">
        <span className={`status-dot ${running ? 'green' : 'red'}`} />
        <span className="status-label">{running ? 'Running' : 'Offline'}</span>
        {running && agents > 0 && (
          <span className="agent-badge">{agents} active</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ id, label, icon }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {profiles.length > 0 && (
        <div className="sidebar-profiles">
          <div className="profiles-label">Profiles</div>
          {profiles.map(p => (
            <div key={p.name} className="profile-item">
              <div className="profile-dot" />
              <div className="profile-info">
                <span className="profile-name">{p.name}</span>
                <span className="profile-model" title={p.model}>{shortModel(p.model)}</span>
              </div>
              {p.sessionCount > 0 && (
                <span className="profile-sessions">{p.sessionCount}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <button
          className={`nav-item settings-btn ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="nav-icon">⚙️</span>
          <span>Settings</span>
          <span className="theme-badge">{THEME_ICONS[theme]}</span>
        </button>
        <div className="footer-info" title={version?.status || ''}>
          <span className="footer-label">
            Hermes {version?.version ? `v${version.version}` : '—'}
          </span>
          {version?.updateAvailable
            ? <span className="footer-update" title={version.status}>update available</span>
            : version?.version && <span className="footer-uptodate" title={version.status}>latest</span>}
        </div>
      </div>
    </aside>
  )
}
