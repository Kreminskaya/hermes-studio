import { useState } from 'react'
import './SetupBanner.css'

interface Props {
  onEnabled: () => void
}

type State = 'idle' | 'writing' | 'restarting' | 'waiting' | 'error'

export default function SetupBanner({ onEnabled }: Props) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  async function enable() {
    setState('writing')
    setError(null)

    // 1. Write API_SERVER_ENABLED=true to .env
    const res = await window.hermes?.enableApiServer?.()
    if (!res?.ok) {
      setError(res?.error ?? 'Не удалось записать настройки')
      setState('error')
      return
    }

    // 2. Restart Hermes via main process
    setState('restarting')
    await window.hermes?.restart?.()

    // 3. Poll until API is up (max 20s)
    setState('waiting')
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const check = await window.hermes?.api?.({ path: '/health' })
      if (check?.ok) {
        onEnabled()
        return
      }
    }

    setError('Hermes перезапустился, но API не отвечает. Попробуй перезапустить вручную.')
    setState('error')
  }

  const labels: Record<State, string> = {
    idle:       'Enable API Server',
    writing:    'Сохраняем настройки…',
    restarting: 'Перезапускаем Hermes…',
    waiting:    'Ждём API…',
    error:      'Попробовать снова',
  }

  return (
    <div className="setup-banner">
      <div className="setup-icon">⚡</div>
      <div className="setup-body">
        <p className="setup-title">Hermes API server is not enabled</p>
        <p className="setup-desc">
          Нажми кнопку — Studio включит API, перезапустит Hermes и подключится автоматически.
        </p>
        {error && <p className="setup-error">{error}</p>}
      </div>
      <button
        className="setup-btn"
        onClick={enable}
        disabled={state !== 'idle' && state !== 'error'}
      >
        {labels[state]}
      </button>
    </div>
  )
}
