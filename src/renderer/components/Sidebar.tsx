import type { Page, GatewayState } from '../App'
import './Sidebar.css'

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  gatewayState: GatewayState | null
}

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'chat',   label: 'Chat',   icon: '💬' },
  { id: 'kanban', label: 'Kanban', icon: '📋' },
  { id: 'cron',   label: 'Cron',   icon: '⏰' },
]

export default function Sidebar({ page, onNavigate, gatewayState }: Props) {
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

      <div className="sidebar-footer">
        <div className="footer-info">
          <span className="footer-label">Hermes v0.12</span>
        </div>
      </div>
    </aside>
  )
}
