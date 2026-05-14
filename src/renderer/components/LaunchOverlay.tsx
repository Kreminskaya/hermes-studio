import './LaunchOverlay.css'

interface Props {
  status: 'starting' | 'error'
  detail: string
  onRetry: () => void
}

export default function LaunchOverlay({ status, detail, onRetry }: Props) {
  return (
    <div className="launch-overlay">
      <div className="launch-card">
        <div className={`launch-icon ${status}`}>
          {status === 'starting' ? (
            <div className="launch-spinner" />
          ) : (
            <span>⚠️</span>
          )}
        </div>
        <div className="launch-title">
          {status === 'starting' ? 'Starting Hermes' : 'Failed to start Hermes'}
        </div>
        <div className="launch-detail">{detail}</div>
        {status === 'error' && (
          <button className="launch-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
