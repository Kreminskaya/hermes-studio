import { useState, useEffect } from 'react'
import './KanbanPage.css'

interface KanbanCard {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'done' | 'blocked'
  agent?: string
  model?: string
  tokens?: number
}

const STATUS_LABELS: Record<KanbanCard['status'], string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
}

const STATUS_COLORS: Record<KanbanCard['status'], string> = {
  todo: '#4a5270',
  in_progress: '#6c63ff',
  done: '#22c55e',
  blocked: '#ef4444',
}

// Parse hermes kanban-status.txt (simple text format)
function parseKanbanStatus(raw: string): KanbanCard[] {
  if (!raw.trim()) return []
  const cards: KanbanCard[] = []
  const lines = raw.split('\n')
  let current: Partial<KanbanCard> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current?.title) cards.push(current as KanbanCard)
      current = null
      continue
    }

    if (trimmed.startsWith('##') || trimmed.startsWith('**')) {
      if (current?.title) cards.push(current as KanbanCard)
      const title = trimmed.replace(/^[#*]+\s*/, '').trim()
      const status: KanbanCard['status'] =
        /done|complete/i.test(title) ? 'done' :
        /block|error|fail/i.test(title) ? 'blocked' :
        /progress|running|active|work/i.test(title) ? 'in_progress' : 'todo'
      current = { id: `k-${Math.random().toString(36).slice(2)}`, title, status }
    } else if (current) {
      if (/agent:/i.test(trimmed)) current.agent = trimmed.replace(/agent:\s*/i, '').trim()
      else if (/model:/i.test(trimmed)) current.model = trimmed.replace(/model:\s*/i, '').trim()
      else if (/status.*in.progress/i.test(trimmed)) current.status = 'in_progress'
      else if (/status.*done/i.test(trimmed)) current.status = 'done'
      else if (/status.*block/i.test(trimmed)) current.status = 'blocked'
    }
  }
  if (current?.title) cards.push(current as KanbanCard)

  return cards.length > 0 ? cards : SAMPLE_CARDS
}

const SAMPLE_CARDS: KanbanCard[] = [
  { id: 's1', title: 'Research phase', status: 'done', agent: 'Architect' },
  { id: 's2', title: 'API integration', status: 'in_progress', agent: 'Coder', model: 'kimi-k2.6' },
  { id: 's3', title: 'UI design', status: 'todo', agent: 'Junior' },
  { id: 's4', title: 'Write tests', status: 'todo' },
]

const COLUMNS: KanbanCard['status'][] = ['todo', 'in_progress', 'done', 'blocked']

export default function KanbanPage() {
  const [cards, setCards] = useState<KanbanCard[]>(SAMPLE_CARDS)
  const [rawStatus, setRawStatus] = useState('')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    loadKanban()
    const unsub = window.hermes?.onKanbanStatus((raw) => {
      setRawStatus(raw)
      setCards(parseKanbanStatus(raw))
      setLastUpdate(new Date())
    })
    return () => unsub?.()
  }, [])

  async function loadKanban() {
    const raw = await window.hermes?.kanbanStatus()
    if (raw) {
      setRawStatus(raw)
      setCards(parseKanbanStatus(raw))
      setLastUpdate(new Date())
    }
  }

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <h2 className="kanban-title">Agent Kanban</h2>
        <div className="kanban-meta">
          {lastUpdate && (
            <span className="kanban-updated">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button className="refresh-btn" onClick={loadKanban} title="Refresh">↺</button>
        </div>
      </div>

      <div className="kanban-board">
        {COLUMNS.map(col => {
          const colCards = cards.filter(c => c.status === col)
          return (
            <div key={col} className="kanban-col">
              <div className="col-header">
                <span
                  className="col-dot"
                  style={{ background: STATUS_COLORS[col] }}
                />
                <span className="col-label">{STATUS_LABELS[col]}</span>
                <span className="col-count">{colCards.length}</span>
              </div>

              <div className="col-cards">
                {colCards.map(card => (
                  <div key={card.id} className={`kanban-card status-${card.status}`}>
                    <div className="card-title">{card.title}</div>
                    <div className="card-footer">
                      {card.agent && (
                        <span className="card-agent">{card.agent}</span>
                      )}
                      {card.model && (
                        <span className="card-model">{card.model}</span>
                      )}
                    </div>
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div className="col-empty">—</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {rawStatus && (
        <details className="kanban-raw">
          <summary>Raw kanban-status.txt</summary>
          <pre>{rawStatus}</pre>
        </details>
      )}
    </div>
  )
}
