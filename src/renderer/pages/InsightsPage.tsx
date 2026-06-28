import { useState, useEffect } from 'react'
import type { HermesInsights } from '../App'
import './InsightsPage.css'

// ─── number helpers ──────────────────────────────────────────────────────────
function fmt(n: number | undefined | null): string {
  const v = n ?? 0
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(v))
}

function fmtCost(n: number | undefined | null): string {
  const v = n ?? 0
  if (v <= 0) return '$0'
  if (v < 0.01) return '<$0.01'
  return '$' + v.toFixed(2)
}

// Local YYYY-MM-DD (matches sqlite date(...,'localtime'))
function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SOURCE_META: Record<string, { label: string; icon: string }> = {
  cli:        { label: 'CLI',       icon: '⌨️' },
  api_server: { label: 'API',       icon: '🔌' },
  cron:       { label: 'Cron',      icon: '⏰' },
  subagent:   { label: 'Subagents', icon: '🤖' },
}

interface Props { active: boolean }

export default function InsightsPage({ active }: Props) {
  const [data, setData] = useState<HermesInsights | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const res = await window.hermes?.insights?.()
    if (res) setData(res)
    setLoading(false)
  }

  // Load once on mount, refresh whenever the page becomes active again
  useEffect(() => { load() }, [])
  useEffect(() => { if (active) load() }, [active])

  if (loading && !data) return (
    <div className="insights-loading">
      <div className="insights-spinner" />
      <span>Loading insights…</span>
    </div>
  )

  const t = data?.totals ?? {}
  const totalTokens = (t.input_tokens ?? 0) + (t.output_tokens ?? 0)

  // Build a continuous 30-day axis so gaps read as real idle days
  const dailyMap = new Map((data?.daily ?? []).map(d => [d.day, d]))
  const today = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (29 - i))
    const key = localKey(d)
    const row = dailyMap.get(key)
    return {
      key,
      date: d,
      tokens: row?.tokens ?? 0,
      sessions: row?.sessions ?? 0,
    }
  })
  const maxDayTokens = Math.max(1, ...days.map(d => d.tokens))

  const byModel = data?.byModel ?? []
  const maxModelTokens = Math.max(1, ...byModel.map(m => m.total_tokens))

  const bySource = data?.bySource ?? []
  const maxSourceSessions = Math.max(1, ...bySource.map(s => s.sessions))

  const stats = [
    { label: 'Sessions',   value: fmt(t.sessions),     hint: 'all-time',                  accent: false },
    { label: 'Tokens',     value: fmt(totalTokens),    hint: `${fmt(t.input_tokens)} in · ${fmt(t.output_tokens)} out`, accent: true },
    { label: 'Tool calls', value: fmt(t.tool_calls),   hint: `${fmt(t.messages)} messages`, accent: false },
    { label: 'Cached',     value: fmt(t.cache_read_tokens), hint: 'tokens read from cache', accent: false },
    { label: 'Cost',       value: fmtCost(t.cost_usd), hint: 'estimated, all models',     accent: false },
  ]

  return (
    <div className="insights-page">
      <div className="insights-header">
        <div>
          <h2 className="insights-title">Insights</h2>
          <p className="insights-subtitle">Usage across every Hermes session on this Mac</p>
        </div>
        <button className="insights-refresh" onClick={load} title="Refresh">↻</button>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
        {stats.map(s => (
          <div key={s.label} className={`stat-card ${s.accent ? 'accent' : ''}`}>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
            <span className="stat-hint">{s.hint}</span>
          </div>
        ))}
      </div>

      {/* Activity chart */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Activity</span>
          <span className="panel-sub">tokens · last 30 days</span>
        </div>
        <div className="activity-chart">
          {days.map(d => (
            <div key={d.key} className="activity-col" title={`${d.key} · ${fmt(d.tokens)} tokens · ${d.sessions} sessions`}>
              <div className="activity-bar-wrap">
                <div
                  className={`activity-bar ${d.tokens === 0 ? 'empty' : ''}`}
                  style={{ height: `${(d.tokens / maxDayTokens) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="activity-axis">
          <span>{days[0].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span>today</span>
        </div>
      </div>

      <div className="insights-columns">
        {/* By model */}
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">By model</span>
            <span className="panel-sub">total tokens</span>
          </div>
          <div className="bar-list">
            {byModel.length === 0 && <div className="empty-note">No data yet</div>}
            {byModel.map(m => (
              <div key={m.model} className="bar-row">
                <div className="bar-row-top">
                  <span className="bar-name" title={m.model}>{m.model}</span>
                  <span className="bar-val">{fmt(m.total_tokens)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(m.total_tokens / maxModelTokens) * 100}%` }} />
                </div>
                <span className="bar-meta">{m.sessions} sessions · {fmtCost(m.cost_usd)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By source */}
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">By source</span>
            <span className="panel-sub">sessions</span>
          </div>
          <div className="bar-list">
            {bySource.length === 0 && <div className="empty-note">No data yet</div>}
            {bySource.map(s => {
              const meta = SOURCE_META[s.source] ?? { label: s.source, icon: '•' }
              return (
                <div key={s.source} className="bar-row">
                  <div className="bar-row-top">
                    <span className="bar-name">{meta.icon} {meta.label}</span>
                    <span className="bar-val">{s.sessions}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill source" style={{ width: `${(s.sessions / maxSourceSessions) * 100}%` }} />
                  </div>
                  <span className="bar-meta">{fmt(s.total_tokens)} tokens</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
