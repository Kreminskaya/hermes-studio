import { useState, useEffect } from 'react'
import './CronPage.css'

interface CronSchedule {
  kind?: string
  expr?: string
  display?: string
}

interface CronJob {
  id: string
  name?: string
  schedule: string | CronSchedule
  prompt?: string
  enabled?: boolean
  last_run?: string
  next_run?: string
}

function scheduleStr(s: string | CronSchedule | undefined): string {
  if (!s) return ''
  if (typeof s === 'string') return s
  return s.display ?? s.expr ?? JSON.stringify(s)
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ schedule: '0 9 * * *', prompt: '' })

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    setLoading(true)
    setError(null)
    try {
      const res = await window.hermes?.api({ path: '/api/jobs' })
      if (res?.ok) {
        const data = res.data as any
        setJobs(Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [])
      } else {
        setError('Cannot reach Hermes API. Make sure the API server is enabled.')
      }
    } catch (e) {
      setError('Cannot reach Hermes API. Make sure the API server is enabled.')
    } finally {
      setLoading(false)
    }
  }

  async function toggleJob(job: CronJob) {
    await window.hermes?.api({
      method: 'PATCH',
      path: `/api/jobs/${job.id}`,
      body: { enabled: !job.enabled },
    })
    loadJobs()
  }

  async function runNow(job: CronJob) {
    await window.hermes?.api({ method: 'POST', path: `/api/jobs/${job.id}/run` })
    loadJobs()
  }

  async function deleteJob(job: CronJob) {
    if (!confirm(`Delete job "${job.name ?? job.id}"?`)) return
    await window.hermes?.api({ method: 'DELETE', path: `/api/jobs/${job.id}` })
    loadJobs()
  }

  async function createJob() {
    if (!form.prompt.trim()) return
    await window.hermes?.api({
      method: 'POST',
      path: '/api/jobs',
      body: { schedule: form.schedule, prompt: form.prompt, enabled: true },
    })
    setShowForm(false)
    setForm({ schedule: '0 9 * * *', prompt: '' })
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
          <button className="save-btn" onClick={createJob} disabled={!form.prompt.trim()}>
            Create Job
          </button>
        </div>
      )}

      {error && <div className="cron-error">{error}</div>}

      {loading && <div className="cron-loading">Loading…</div>}

      {!loading && !error && jobs.length === 0 && (
        <div className="cron-empty">
          <div className="empty-icon">⏰</div>
          <p>No cron jobs yet.</p>
          <p className="empty-sub">Create one to schedule recurring agent tasks.</p>
        </div>
      )}

      <div className="jobs-list">
        {jobs.map(job => (
          <div key={job.id} className={`job-card ${job.enabled === false ? 'disabled' : ''}`}>
            <div className="job-left">
              <span className={`job-dot ${job.enabled !== false ? 'green' : 'dim'}`} />
              <div>
                <div className="job-name">{job.name ?? job.id}</div>
                <code className="job-schedule">{scheduleStr(job.schedule)}</code>
                {job.prompt && (
                  <div className="job-prompt">{job.prompt.slice(0, 80)}{job.prompt.length > 80 ? '…' : ''}</div>
                )}
                <div className="job-times">
                  {job.last_run && <span>Last: {new Date(job.last_run).toLocaleString()}</span>}
                  {job.next_run && <span>Next: {new Date(job.next_run).toLocaleString()}</span>}
                </div>
              </div>
            </div>
            <div className="job-btns">
              <button className="job-btn" onClick={() => runNow(job)} title="Run now">▶</button>
              <button
                className={`job-btn ${job.enabled !== false ? 'pause' : 'play'}`}
                onClick={() => toggleJob(job)}
                title={job.enabled !== false ? 'Pause' : 'Resume'}
              >
                {job.enabled !== false ? '⏸' : '▶'}
              </button>
              <button className="job-btn del" onClick={() => deleteJob(job)} title="Delete">🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
