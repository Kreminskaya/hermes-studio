import { useState, useEffect, useRef } from 'react'
import type { HermesVersion } from '../App'
import './SettingsPage.css'

export type Theme = 'dark' | 'light' | 'gray'

interface Props {
  theme: Theme
  onTheme: (t: Theme) => void
}

const THEMES: { id: Theme; label: string; desc: string; preview: [string, string] }[] = [
  { id: 'dark',  label: 'Deep Space',         desc: 'Чёрный фон, фиолетовый акцент', preview: ['#08090f', '#7c6fff'] },
  { id: 'light', label: 'Light',              desc: 'Светлый фон, лавандовый акцент', preview: ['#f0eef8', '#6c5fff'] },
  { id: 'gray',  label: 'Lime & Raspberry',   desc: 'Серый фон, лайм и малина',       preview: ['#1a1a1d', '#a3e635'] },
]

export default function SettingsPage({ theme, onTheme }: Props) {
  // ─── Hermes version + update ──────────────────────────────────────────────
  const [version, setVersion] = useState<HermesVersion | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ available: boolean; behind: number | null; raw: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [updateOk, setUpdateOk] = useState<boolean | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // ─── Notifications ────────────────────────────────────────────────────────
  const [notif, setNotif] = useState(() => {
    const v = localStorage.getItem('hermes_notifications')
    return v === null ? true : v === 'true'
  })

  async function loadVersion() {
    const v = await window.hermes?.hermesVersion?.()
    if (v?.ok) setVersion(v)
  }

  useEffect(() => { loadVersion() }, [])

  useEffect(() => {
    const offProgress = window.hermes?.onUpdateProgress?.((e) => {
      setLog(prev => [...prev, e.line])
    })
    const offDone = window.hermes?.onUpdateDone?.((e) => {
      setUpdating(false)
      setUpdateOk(e.ok)
      setLog(prev => [...prev, e.ok ? '✓ Update complete' : `✗ Update failed${e.error ? `: ${e.error}` : ''}`])
      loadVersion()
      setCheckResult(null)
    })
    return () => { offProgress?.(); offDone?.() }
  }, [])

  // Auto-scroll the progress log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  async function handleCheck() {
    setChecking(true)
    setCheckResult(null)
    const res = await window.hermes?.updateCheck?.()
    setChecking(false)
    if (res?.ok) {
      setCheckResult({ available: !!res.available, behind: res.behind ?? null, raw: res.raw ?? '' })
    } else {
      setCheckResult({ available: false, behind: null, raw: res?.error ?? 'Check failed' })
    }
  }

  async function handleUpdate() {
    setConfirming(false)
    setUpdating(true)
    setUpdateOk(null)
    setLog([])
    const res = await window.hermes?.updateRun?.()
    if (!res?.ok) {
      setUpdating(false)
      setLog([`✗ Could not start: ${res?.error ?? 'unknown error'}`])
    }
  }

  function toggleNotif() {
    const next = !notif
    setNotif(next)
    localStorage.setItem('hermes_notifications', String(next))
    window.hermes?.setNotifications?.(next)
    if (next) window.hermes?.testNotification?.()
  }

  const updateAvailable = checkResult?.available || version?.updateAvailable

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="settings-title">Settings</h2>
      </div>

      <div className="settings-body">
        {/* ─── Hermes ──────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="section-title">Hermes</h3>
          <p className="section-sub">Runtime version & updates</p>

          <div className="set-card">
            <div className="set-row">
              <div className="set-row-main">
                <span className="set-row-title">
                  Hermes {version?.version ? `v${version.version}` : '—'}
                  {version?.build && <span className="set-row-build">({version.build})</span>}
                </span>
                <span className="set-row-sub">
                  {updateAvailable
                    ? `Update available${checkResult?.behind ? ` · ${checkResult.behind} commits behind` : ''}`
                    : (version?.status || 'Up to date')}
                </span>
              </div>
              <div className="set-row-actions">
                <button className="btn ghost" onClick={handleCheck} disabled={checking || updating}>
                  {checking ? 'Checking…' : 'Check for updates'}
                </button>
                {updateAvailable && !updating && !confirming && (
                  <button className="btn primary" onClick={() => setConfirming(true)} disabled={updating}>
                    Update now
                  </button>
                )}
              </div>
            </div>

            {confirming && (
              <div className="set-confirm">
                <span>Обновить Hermes? Сделаю полный бэкап <code>~/.hermes</code> перед обновлением. Gateway может ненадолго перезапуститься.</span>
                <div className="set-confirm-actions">
                  <button className="btn primary" onClick={handleUpdate}>Да, обновить</button>
                  <button className="btn ghost" onClick={() => setConfirming(false)}>Отмена</button>
                </div>
              </div>
            )}

            {(updating || log.length > 0) && (
              <div className="set-log" ref={logRef}>
                {updating && <div className="set-log-spinner"><span className="set-spin" /> updating…</div>}
                {log.map((l, i) => (
                  <div key={i} className={`set-log-line ${l.startsWith('✓') ? 'ok' : l.startsWith('✗') ? 'err' : ''}`}>{l}</div>
                ))}
              </div>
            )}

            {updateOk === true && !updating && (
              <div className="set-note ok">Готово — Hermes обновлён. Перезапусти студию, чтобы подхватить изменения рантайма.</div>
            )}
          </div>
        </section>

        {/* ─── Notifications ───────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="section-title">Notifications</h3>
          <p className="section-sub">Уведомления macOS о завершении задач</p>

          <div className="set-card">
            <button className="set-toggle-row" onClick={toggleNotif}>
              <div className="set-row-main">
                <span className="set-row-title">Уведомлять о завершении задач</span>
                <span className="set-row-sub">Всплывающее уведомление, когда агент завершает задачу в Kanban</span>
              </div>
              <span className={`switch ${notif ? 'on' : ''}`}><span className="switch-knob" /></span>
            </button>
          </div>
        </section>

        {/* ─── Appearance ──────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="section-title">Appearance</h3>
          <p className="section-sub">Choose a color theme for the interface</p>

          <div className="theme-grid">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`theme-card ${theme === t.id ? 'active' : ''}`}
                onClick={() => onTheme(t.id)}
              >
                <div className="theme-preview" style={{ background: t.preview[0] }}>
                  <div className="preview-sidebar" />
                  <div className="preview-content">
                    <div className="preview-bar" style={{ background: t.preview[1], opacity: 0.9 }} />
                    <div className="preview-lines">
                      <div className="preview-line long" />
                      <div className="preview-line short" />
                      <div className="preview-line medium" />
                    </div>
                  </div>
                  {theme === t.id && (
                    <div className="preview-check" style={{ background: t.preview[1] }}>✓</div>
                  )}
                </div>
                <div className="theme-info">
                  <span className="theme-label">{t.label}</span>
                  <span className="theme-desc">{t.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
