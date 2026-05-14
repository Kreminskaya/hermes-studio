import { useState, useEffect, useMemo } from 'react'
import type { KanbanTask } from '../App'
import './KanbanPage.css'

const STATUS_ORDER = ['todo', 'in_progress', 'done', 'blocked']

const STATUS_META: Record<string, { label: string; color: string }> = {
  todo:        { label: 'To Do',       color: '#4a5270' },
  in_progress: { label: 'In Progress', color: '#7c6fff' },
  done:        { label: 'Done',        color: '#34d399' },
  blocked:     { label: 'Blocked',     color: '#f87171' },
}

function statusMeta(s: string) {
  return STATUS_META[s] ?? { label: s.replace(/_/g, ' '), color: '#6b7280' }
}

function fmtDuration(startSec: number | null, endSec: number | null): string {
  if (!startSec) return ''
  const end = endSec ?? Math.floor(Date.now() / 1000)
  const sec = end - startSec
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

export default function KanbanPage() {
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    loadTasks()
    const unsub = window.hermes?.onKanbanRefresh(loadTasks)
    return () => unsub?.()
  }, [])

  async function loadTasks() {
    const data = await window.hermes?.kanbanTasks()
    if (data) {
      setTasks(data as KanbanTask[])
      setLastUpdate(new Date())
    }
    setLoading(false)
  }

  // Derive columns dynamically from whatever statuses exist in the data
  const columns = useMemo(() => {
    const found = [...new Set(tasks.map(t => t.status))]
    const ordered = STATUS_ORDER.filter(s => found.includes(s))
    const rest = found.filter(s => !STATUS_ORDER.includes(s)).sort()
    return [...ordered, ...rest]
  }, [tasks])

  if (loading) {
    return (
      <div className="kanban-page">
        <KanbanHeader onRefresh={loadTasks} lastUpdate={null} />
        <div className="kanban-empty">
          <div className="spinner" />
          <span>Loading tasks…</span>
        </div>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="kanban-page">
        <KanbanHeader onRefresh={loadTasks} lastUpdate={lastUpdate} />
        <div className="kanban-empty">
          <span className="empty-icon">📋</span>
          <span>No tasks yet</span>
          <span className="empty-sub">Tasks appear here when Hermes agents start working</span>
        </div>
      </div>
    )
  }

  const gridCols = Math.max(1, Math.min(columns.length, 5))

  return (
    <div className="kanban-page">
      <KanbanHeader onRefresh={loadTasks} lastUpdate={lastUpdate} />
      <div
        className="kanban-board"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(200px, 1fr))` }}
      >
        {columns.map(status => {
          const col = tasks.filter(t => t.status === status)
          const meta = statusMeta(status)
          return (
            <div key={status} className="kanban-col">
              <div className="col-header">
                <span className="col-dot" style={{ background: meta.color }} />
                <span className="col-label">{meta.label}</span>
                <span className="col-count">{col.length}</span>
              </div>
              <div className="col-cards">
                {col.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    expanded={expanded === task.id}
                    onToggle={() => setExpanded(prev => prev === task.id ? null : task.id)}
                  />
                ))}
                {col.length === 0 && <div className="col-empty">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanHeader({ onRefresh, lastUpdate }: { onRefresh: () => void; lastUpdate: Date | null }) {
  return (
    <div className="kanban-header">
      <h2 className="kanban-title">Agent Kanban</h2>
      <div className="kanban-meta">
        {lastUpdate && (
          <span className="kanban-updated">Updated {lastUpdate.toLocaleTimeString()}</span>
        )}
        <button className="refresh-btn" onClick={onRefresh} title="Refresh">↺</button>
      </div>
    </div>
  )
}

function TaskCard({ task, expanded, onToggle }: {
  task: KanbanTask
  expanded: boolean
  onToggle: () => void
}) {
  const isRunning = task.run_status === 'running'
  const duration = fmtDuration(task.run_started_at, task.run_ended_at)

  return (
    <div
      className={`kanban-card status-${task.status}${expanded ? ' expanded' : ''}`}
      onClick={onToggle}
    >
      <div className="card-title">{task.title}</div>

      {expanded && task.body && (
        <div className="card-body">{task.body}</div>
      )}

      <div className="card-footer">
        {task.assignee && (
          <span className="card-agent">{task.assignee}</span>
        )}
        {task.run_profile && (
          <span className="card-model">{task.run_profile}</span>
        )}
        {task.outcome && (
          <span className={`card-outcome outcome-${task.outcome}`}>{task.outcome}</span>
        )}
        {isRunning && (
          <span className="card-running">
            <span className="run-dot" />
            {duration || 'running'}
          </span>
        )}
        {!isRunning && duration && (
          <span className="card-duration">{duration}</span>
        )}
      </div>

      {task.consecutive_failures > 0 && (
        <div className="card-failures">
          {task.consecutive_failures} failure{task.consecutive_failures !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
