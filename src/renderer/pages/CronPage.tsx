import { useState, useEffect } from 'react'
import './CronPage.css'

interface CronSchedule { kind?: string; expr?: string; display?: string }
interface CronJob {
  id: string
  name?: string
  prompt?: string
  script?: string | null
  no_agent?: boolean
  schedule: string | CronSchedule
  schedule_display?: string
  repeat?: { times: number | null; completed: number }
  enabled?: boolean
  state?: string
  paused_at?: string | null
  paused_reason?: string | null
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  deliver?: string
}

function scheduleStr(j: CronJob): string {
  if (j.schedule_display) return j.schedule_display
  const s = j.schedule
  if (!s) return ''
  if (typeof s === 'string') return s
  return s.display ?? s.expr ?? ''
}

function isPaused(j: CronJob): boolean {
  return j.state === 'paused' || !!j.paused_at
}

// Relative time that works for both past (last run) and future (next run)
function rel(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diff = (t - Date.now()) / 1000
  const a = Math.abs(diff)
  if (a < 30) return diff >= 0 ? 'now' : 'just now'
  const u = a < 60 ? `${Math.round(a)}s`
          : a < 3600 ? `${Math.round(a / 60)}m`
          : a < 86400 ? `${Math.round(a / 3600)}h`
          : `${Math.round(a / 86400)}d`
  return diff >= 0 ? `in ${u}` : `${u} ago`
}

function resErr(res: any): string | null {
  if (!res) return 'No response from Hermes'
  if (res.ok === false) return res.error || 'Request failed'
  if (res.status && res.status >= 400) return (res.data && res.data.error) || `HTTP ${res.status}`
  return null
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', schedule: '0 9 * * *', prompt: '' })

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    setLoading(true)
    setError(null)
    try {
      const res = await window.hermes?.api({ path: '/api/jobs' })
      if (res?.ok && (res.status ?? 200) < 400) {
        const data = res.data as any
        setJobs(Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [])
      } else {
        setError('Cannot reach Hermes API. Make sure the API server is enabled.')
      }
    } catch {
      setError('Cannot reach Hermes API. Make sure the API server is enabled.')
    } finally {
      setLoading(false)
    }
  }

  async function act(id: string, run: () => Promise<any>) {
    setBusy(id)
    setActionErr(null)
    try {
      const res = await run()
      const err = resErr(res)
      if (err) setActionErr(err)
    } catch (e: any) {
      setActionErr(e?.message ?? 'Action failed')
    } finally {
      setBusy(null)
      loadJobs()
    }
  }

  const runNow  = (j: CronJob) => act(j.id, () => window.hermes!.api({ method: 'POST', path: `/api/jobs/${j.id}/run` }))
  const pause   = (j: CronJob) => act(j.id, () => window.hermes!.api({ method: 'POST', path: `/api/jobs/${j.id}/pause` }))
  const resume  = (j: CronJob) => act(j.id, () => window.hermes!.api({ method: 'POST', path: `/api/jobs/${j.id}/resume` }))
  const remove  = (j: CronJob) => {
    if (!confirm(`Delete job "${j.name ?? j.id}"? This cannot be undone.`)) return
    act(j.id, () => window.hermes!.api({ method: 'DELETE', path: `/api/jobs/${j.id}` }))
  }

  async function createJob() {
    if (!form.name.trim() || !form.schedule.trim()) return
    setActionErr(null)
    const res = await window.hermes?.api({
      method: 'POST',
      path: '/api/jobs',
      body: { name: form.name.trim(), schedule: form.schedule.trim(), prompt: form.prompt },
    })
    const err = resErr(res)
    if (err) { setActionErr(err); return }
    setShowForm(false)
    setForm({ name: '', schedule: '0 9 * * *', prompt: '' })
    loadJobs()
  }

  return (
    <div className="cron-page">
      <div className="cron-header">
        <h2 className="cron-title">Cron Jobs</h2>
        <div className="cron-actions">
          <button className="refresh-btn" onClick={loadJobs} title="Refresh">↺</button>
          <button className="add-btn" onClick={() => setShowForm(v => !v)}>
            {showForm ? '✕ Cancel' : '+ New Job'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="cron-form">
          <div className="form-row">
            <label>Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="daily-digest"
            />
          </div>
          <div className="form-row">
            <label>Schedule (cron)</label>
            <input
              className="form-input"
              value={form.schedule}
              onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))}
              placeholder="0 9 * * *"
            />
            <span className="form-hint">minute hour day month weekday</span>
          </div>
          <div className="form-row">
            <label>Prompt</label>
            <textarea
              className="form-input form-textarea"
              value={form.prompt}
              onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
              placeholder="What should the agent do?"
              rows={3}
            />
          </div>
          <button className="save-btn" onClick={createJob} disabled={!form.name.trim() || !form.schedule.trim()}>
            Create Job
          </button>
        </div>
      )}

      {error && <div className="cron-error">{error}</div>}
      {actionErr && <div className="cron-error">{actionErr}</div>}

      {loading && jobs.length === 0 && <div className="cron-loading">Loading…</div>}

      {!loading && !error && jobs.length === 0 && (
        <div className="cron-empty">
          <div className="empty-icon">⏰</div>
          <p>No cron jobs yet.</p>
          <p className="empty-sub">Create one to schedule recurring agent tasks.</p>
        </div>
      )}

      <div className="jobs-list">
        {jobs.map(job => {
          const paused = isPaused(job)
          const status = job.last_status?.toLowerCase()
          return (
            <div key={job.id} className={`job-card ${paused ? 'disabled' : ''}`}>
              <div className="job-left">
                <span className={`job-dot ${paused ? 'dim' : 'green'}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="job-head-row">
                    <span className="job-name">{job.name ?? job.id}</span>
                    {job.no_agent || job.script
                      ? <span className="job-tag script">script</span>
                      : <span className="job-tag agent">agent</span>}
                    {paused && <span className="job-tag paused">paused</span>}
                  </div>

                  <div className="job-meta-row">
                    <code className="job-schedule">{scheduleStr(job)}</code>
                    {status && (
                      <span className={`job-status ${status === 'ok' ? 'ok' : 'err'}`} title={job.last_error ?? ''}>
                        {status === 'ok' ? '✓ ok' : `✗ ${status}`}
                      </span>
                    )}
                    {typeof job.repeat?.completed === 'number' && (
                      <span className="job-runs">{job.repeat.completed.toLocaleString()} runs</span>
                    )}
                  </div>

                  {job.prompt && job.prompt !== 'placeholder' && (
                    <div className="job-prompt">{job.prompt.slice(0, 90)}{job.prompt.length > 90 ? '…' : ''}</div>
                  )}
                  {job.script && <div className="job-prompt mono">→ {job.script}</div>}

                  <div className="job-times">
                    <span>Last: {rel(job.last_run_at)}</span>
                    <span>Next: {paused ? '—' : rel(job.next_run_at)}</span>
                    {paused && job.paused_reason && <span className="job-paused-reason">{job.paused_reason}</span>}
                  </div>
                  {status === 'error' && job.last_error && (
                    <div className="job-error" title={job.last_error}>{job.last_error.slice(0, 120)}</div>
                  )}
                </div>
              </div>

              <div className="job-btns">
                <button className="job-btn" onClick={() => runNow(job)} disabled={busy === job.id} title="Run now">▶</button>
                {paused
                  ? <button className="job-btn play" onClick={() => resume(job)} disabled={busy === job.id} title="Resume">⏵</button>
                  : <button className="job-btn pause" onClick={() => pause(job)} disabled={busy === job.id} title="Pause">⏸</button>}
                <button className="job-btn del" onClick={() => remove(job)} disabled={busy === job.id} title="Delete">🗑</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
