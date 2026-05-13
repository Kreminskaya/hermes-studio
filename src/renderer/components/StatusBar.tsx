import type { GatewayState } from '../App'
import './StatusBar.css'

interface Props {
  gatewayState: GatewayState | null
  apiReady: boolean
}

export default function StatusBar({ gatewayState, apiReady }: Props) {
  return (
    <div className="statusbar">
      <span className={`sb-pill ${gatewayState?.gateway_state === 'running' ? 'green' : 'dim'}`}>
        Gateway {gatewayState?.gateway_state ?? 'unknown'}
      </span>
      <span className={`sb-pill ${apiReady ? 'green' : 'dim'}`}>
        API :{apiReady ? '8642' : 'offline'}
      </span>
      {gatewayState?.pid && (
        <span className="sb-pill dim">PID {gatewayState.pid}</span>
      )}
    </div>
  )
}
