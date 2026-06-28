import { useState, useEffect, useMemo } from 'react'
import type { HistorySession, HermesMessage } from '../App'
import './HistoryPage.css'

function fmt(n: number | null | undefined): string {
  const v = n ?? 0
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(v))
}

function fmtDate(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = Date.now()
  const diff = (now - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  cli:        { label: 'CLI',      cls: 'src-cli' },
  api_server: { label: 'API',      cls: 'src-api' },
  cron:       { label: 'Cron',     cls: 'src-cron' },
  subagent:   { label: 'Subagent', cls: 'src-sub' },
}

function title(s: HistorySession): string {
  if (s.title && s.title.trim()) return s.title.trim()
  if (s.first_user_msg && s.first_user_msg.trim()) {
    const t = s.first_user_msg.trim().replace(/\s+/g, ' ')
    return t.length > 80 ? t.slice(0, 80) + '…' : t
  }
  return s.id
}

interface Props { active: boolean }

export default function HistoryPage({ active }: Props) {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<string>('all')

  const [selected, setSelected] = useState<HistorySession | null>(null)
  const [messages, setMessages] = useState<HermesMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  async function load() {
    const rows = await window.hermes?.sessionsHistory?.()
    setSessions(rows ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (active) load() }, [active])

  async function openSession(s: HistorySession) {
    setSelected(s)
    setLoadingMsgs(true)
    setMessages([])
    const msgs = await window.hermes?.sessionMessages?.(s.id)
    setMessages(msgs ?? [])
    setLoadingMsgs(false)
  }

  // Source chips with counts
  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions) {
      const key = s.source ?? 'other'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [sessions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter(s => {
      if (source !== 'all' && (s.source ?? 'other') !== source) return false
      if (!q) return true
      return (
        (s.title ?? '').toLowerCase().includes(q) ||
        (s.first_user_msg ?? '').toLowerCase().includes(q) ||
        (s.model ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      )
    })
  }, [sessions, query, source])

  if (loading) return (
    <div className="history-loading">
      <div className="history-spinner" />
      <span>Loading history…</span>
    </div>
  )

  return (
    <div className="history-page">
      <div className="history-main">
        <div className="history-header">
          <div>
            <h2 className="history-title">History</h2>
            <p className="history-subtitle">{sessions.length} sessions · click to read</p>
          </div>
          <input
            className="history-search"
            placeholder="Search title, message, model…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="history-filters">
          <button className={`chip ${source === 'all' ? 'active' : ''}`} onClick={() => setSource('all')}>
            All <span className="chip-count">{sessions.length}</span>
          </button>
          {sources.map(([src, n]) => (
            <button key={src} className={`chip ${source === src ? 'active' : ''}`} onClick={() => setSource(src)}>
              {SOURCE_META[src]?.label ?? src} <span className="chip-count">{n}</span>
            </button>
          ))}
        </div>

        <div className="history-list">
          {filtered.length === 0 && <div className="history-empty">Nothing matches “{query}”.</div>}
          {filtered.map(s => {
            const meta = SOURCE_META[s.source ?? ''] ?? { label: s.source ?? 'other', cls: 'src-other' }
            return (
              <button
                key={s.id}
                className={`history-row ${selected?.id === s.id ? 'selected' : ''}`}
                onClick={() => openSession(s)}
              >
                <div className="row-top">
                  <span className="row-title">{title(s)}</span>
                  <span className="row-date">{fmtDate(s.started_at)}</span>
                </div>
                <div className="row-meta">
                  <span className={`src-badge ${meta.cls}`}>{meta.label}</span>
                  {s.model && <span className="row-model">{s.model}</span>}
                  <span className="row-dot">·</span>
                  <span>{s.message_count} msg</span>
                  <span className="row-dot">·</span>
                  <span>{fmt((s.input_tokens ?? 0) + (s.output_tokens ?? 0))} tok</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="history-detail">
          <div className="detail-head">
            <div className="detail-head-main">
              <span className="detail-title">{title(selected)}</span>
              <span className="detail-sub">
                {selected.model ?? 'unknown model'} · {fmtDate(selected.started_at)} · {selected.message_count} messages
              </span>
            </div>
            <button className="detail-close" onClick={() => setSelected(null)} title="Close">✕</button>
          </div>
          <div className="detail-body">
            {loadingMsgs && <div className="detail-loading"><span className="history-spinner small" /> loading messages…</div>}
            {!loadingMsgs && messages.length === 0 && <div className="history-empty">No messages stored for this session.</div>}
            {!loadingMsgs && messages.map(m => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                <span className="msg-role">{m.role === 'tool' ? (m.tool_name ?? 'tool') : m.role}</span>
                <div className="msg-content">
                  {(m.content ?? '').trim() || <span className="msg-empty">(no text content)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
