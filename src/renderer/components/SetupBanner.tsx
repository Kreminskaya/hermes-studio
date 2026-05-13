import { useState } from 'react'
import './SetupBanner.css'

interface Props {
  onEnabled: () => void
}

export default function SetupBanner({ onEnabled }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enable() {
    setLoading(true)
    setError(null)
    const res = await window.hermes?.enableApiServer?.()
    setLoading(false)
    if (res?.ok) {
      onEnabled()
    } else {
      setError(res?.error ?? 'Unknown error')
    }
  }

  return (
    <div className="setup-banner">
      <div className="setup-icon">⚡</div>
      <div className="setup-body">
        <p className="setup-title">Hermes API server is not enabled</p>
        <p className="setup-desc">
          Enable it to allow Hermes Studio to communicate with your agent.
          This adds <code>API_SERVER_ENABLED=true</code> to <code>~/.hermes/.env</code>.
          Restart Hermes after enabling.
        </p>
        {error && <p className="setup-error">{error}</p>}
      </div>
      <button className="setup-btn" onClick={enable} disabled={loading}>
        {loading ? 'Enabling…' : 'Enable API Server'}
      </button>
    </div>
  )
}
