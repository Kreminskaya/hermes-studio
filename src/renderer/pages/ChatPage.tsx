import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSessions } from '../hooks/useSession'
import type { HermesSession, HermesMessage } from '../App'
import './ChatPage.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
  tokens?: number
}

interface Props {
  apiReady: boolean
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

function generateSessionId(): string {
  return `hs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function dbToMessages(dbMsgs: HermesMessage[]): Message[] {
  return dbMsgs
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content!,
      tokens: m.token_count ?? undefined,
    }))
}

export default function ChatPage({ apiReady }: Props) {
  const { sessions, loading: sessionsLoading, reload: reloadSessions } = useSessions()
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [loadingMsgs, setLoadingMsgs] = useState<string | null>(null)
  // tracks a locally-generated ID that hasn't been confirmed by Hermes yet
  const pendingLocalIdRef = useRef<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeTool, setActiveTool] = useState<{ emoji: string; label: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [models, setModels] = useState<string[]>(['hermes-agent'])
  const [model, setModel] = useState('hermes-agent')
  const bottomRef = useRef<HTMLDivElement>(null)

  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // When sessions list updates and we have a pending local ID,
  // find the newly created real session and migrate to it
  useEffect(() => {
    const localId = pendingLocalIdRef.current
    if (!localId || sessions.length === 0) return
    const newest = sessions[0]
    if (newest.id === localId) return // already matched somehow
    // newest session not yet in our messages map → it's the one Hermes just created
    setMessages(prev => {
      if (prev[newest.id]) return prev // already have it
      const localMsgs = prev[localId] ?? []
      const next = { ...prev, [newest.id]: localMsgs }
      delete next[localId]
      return next
    })
    setCurrentId(newest.id)
    pendingLocalIdRef.current = null
  }, [sessions])

  useEffect(() => { if (apiReady) loadModels() }, [apiReady])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentId, activeTool])

  useEffect(() => {
    if (streaming) {
      setElapsed(0)
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      setActiveTool(null)
      setElapsed(0)
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current) }
  }, [streaming])

  async function loadModels() {
    const res = await window.hermes?.api({ path: '/v1/models' })
    if (res?.ok && Array.isArray((res.data as any)?.data)) {
      setModels((res.data as any).data.map((m: any) => m.id))
    }
  }

  async function selectSession(id: string) {
    setCurrentId(id)
    if (!messages[id]) {
      setLoadingMsgs(id)
      const dbMsgs = await window.hermes?.sessionMessages(id) ?? []
      setMessages(prev => ({ ...prev, [id]: dbToMessages(dbMsgs) }))
      setLoadingMsgs(null)
    }
  }

  function newChat() {
    const id = generateSessionId()
    pendingLocalIdRef.current = id
    setCurrentId(id)
    setMessages(prev => ({ ...prev, [id]: [] }))
  }

  // If currentId is not in DB sessions yet, show it as pending entry at top
  const displaySessions = useMemo(() => {
    if (currentId && !sessions.find(s => s.id === currentId)) {
      const pending = { id: currentId, title: 'New chat', _pending: true } as any
      return [pending, ...sessions]
    }
    return sessions
  }, [sessions, currentId])

  const currentMsgs = currentId ? (messages[currentId] ?? []) : []
  const activeSession: HermesSession | null = sessions.find(s => s.id === currentId) ?? null

  function appendMsg(msg: Message) {
    if (!currentId) return
    setMessages(prev => ({ ...prev, [currentId]: [...(prev[currentId] ?? []), msg] }))
  }

  function patchLastMsg(patch: Partial<Message>) {
    if (!currentId) return
    setMessages(prev => {
      const list = [...(prev[currentId] ?? [])]
      if (!list.length) return prev
      list[list.length - 1] = { ...list[list.length - 1], ...patch }
      return { ...prev, [currentId]: list }
    })
  }

  async function send() {
    if (!input.trim() || streaming || !apiReady) return

    let sid = currentId
    if (!sid) {
      sid = generateSessionId()
      pendingLocalIdRef.current = sid
      setCurrentId(sid)
      setMessages(prev => ({ ...prev, [sid!]: [] }))
    }

    const userText = input.trim()
    setInput('')

    setMessages(prev => ({
      ...prev,
      [sid!]: [...(prev[sid!] ?? []), { role: 'user', content: userText }, { role: 'assistant', content: '' }],
    }))
    setStreaming(true)

    // Mark as pending so we detect the real session Hermes creates
    if (!pendingLocalIdRef.current && !sessions.find(s => s.id === sid)) {
      pendingLocalIdRef.current = sid
    }

    try {
      const history = (messages[sid] ?? []).filter(m => m.role !== 'assistant' || m.content)
      const body = {
        model,
        messages: [
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: userText },
        ],
        stream: true,
      }

      const runId = await window.hermes?.streamStart({
        path: '/v1/chat/completions',
        body,
      })
      if (!runId) throw new Error('No run ID')

      let buf = ''
      let totalTokens = 0
      let currentEvent = ''

      const unsub = window.hermes?.onStream(runId, (event) => {
        if (event.type === 'chunk' && event.data) {
          const lines = (buf + event.data).split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
              continue
            }
            if (!line.startsWith('data: ')) { currentEvent = ''; continue }
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') { currentEvent = ''; continue }

            try {
              const parsed = JSON.parse(raw)

              // Hermes tool progress events
              if (currentEvent === 'hermes.tool.progress') {
                const { emoji, tool, label, status } = parsed
                if (status === 'running') {
                  const display = label && label !== '*' ? label : tool
                  setActiveTool({ emoji: emoji ?? '⚙️', label: display })
                } else if (status === 'completed') {
                  setActiveTool(null)
                }
                currentEvent = ''
                continue
              }

              currentEvent = ''

              // Text content
              const delta = parsed.choices?.[0]?.delta?.content ?? ''
              if (delta) {
                setActiveTool(null)
                setMessages(prev => {
                  const list = [...(prev[sid!] ?? [])]
                  const last = list[list.length - 1]
                  if (last?.role === 'assistant') {
                    list[list.length - 1] = { ...last, content: last.content + delta }
                  }
                  return { ...prev, [sid!]: list }
                })
              }
              if (parsed.usage) totalTokens = parsed.usage.total_tokens ?? totalTokens
            } catch {}
          }
        }
        if (event.type === 'end' || event.type === 'error') {
          setStreaming(false)
          unsub?.()
          if (totalTokens > 0) patchLastMsg({ tokens: totalTokens })
          // reload sessions so new/updated session appears in the list
          setTimeout(() => reloadSessions(), 400)
        }
      })
    } catch (e: any) {
      patchLastMsg({ content: `Error: ${e.message}` })
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="chat-layout">
      {/* Session sidebar */}
      <div className="session-list">
        <button className="new-chat-btn" onClick={newChat}>+ New chat</button>
        <div className="sessions-scroll">
          {sessionsLoading && (
            <div className="sessions-loading">Loading sessions…</div>
          )}
          {displaySessions.map((s: any) => {
            const isDb = !s._pending
            const totalTok = isDb ? ((s.input_tokens ?? 0) + (s.output_tokens ?? 0)) : 0
            const cost = isDb ? (s.actual_cost_usd ?? s.estimated_cost_usd ?? 0) : 0
            return (
              <div
                key={s.id}
                className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => isDb ? selectSession(s.id) : setCurrentId(s.id)}
              >
                <span className="session-title">{s.title ?? 'Untitled'}</span>
                <div className="session-meta">
                  {isDb && s.started_at && (
                    <span className="session-time">{fmtTime(s.started_at)}</span>
                  )}
                  {totalTok > 0 && (
                    <span className="session-tokens">{fmtTokens(totalTok)}</span>
                  )}
                  {cost > 0 && (
                    <span className="session-cost">${cost.toFixed(3)}</span>
                  )}
                </div>
              </div>
            )
          })}
          {!sessionsLoading && displaySessions.length === 0 && (
            <div className="sessions-empty">No sessions yet</div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="chat-area">
        <div className="chat-header">
          <select
            className="model-select"
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {activeSession && (
            <span className="chat-stats">
              {((activeSession.input_tokens ?? 0) + (activeSession.output_tokens ?? 0)) > 0 &&
                `${fmtTokens((activeSession.input_tokens ?? 0) + (activeSession.output_tokens ?? 0))} tokens`
              }
              {(activeSession.actual_cost_usd ?? activeSession.estimated_cost_usd) != null &&
                ` · $${(activeSession.actual_cost_usd ?? activeSession.estimated_cost_usd)!.toFixed(4)}`
              }
            </span>
          )}
        </div>

        <div className="messages-area">
          {!currentId ? (
            <div className="empty-state">
              <div className="empty-icon">🤖</div>
              <p>Start a new chat or select a session</p>
            </div>
          ) : loadingMsgs === currentId ? (
            <div className="empty-state">
              <div className="spinner" />
              <p>Loading messages…</p>
            </div>
          ) : (
            <>
              {currentMsgs.map((msg, i) => (
                <div key={i} className={`message ${msg.role}`}>
                  <div className="msg-avatar">{msg.role === 'user' ? 'You' : 'H'}</div>
                  <div className="msg-body">
                    <div
                      className="msg-content md-content"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                    {msg.tokens && msg.tokens > 0 && (
                      <div className="msg-meta">{fmtTokens(msg.tokens)} tokens</div>
                    )}
                  </div>
                </div>
              ))}
              {currentMsgs.length === 0 && !streaming && (
                <div className="empty-state">
                  <div className="empty-icon">💬</div>
                  <p>Say something to Hermes</p>
                </div>
              )}
            </>
          )}
          {streaming && (
            <div className="agent-status">
              {activeTool ? (
                <div className="tool-chip">
                  <span className="tool-chip-emoji">{activeTool.emoji}</span>
                  <span className="tool-chip-label">{activeTool.label}</span>
                  <span className="tool-chip-dot" />
                </div>
              ) : (
                <div className="think-chip">
                  <span className="think-dot" /><span className="think-dot" /><span className="think-dot" />
                  {elapsed >= 8 && <span className="think-elapsed">{elapsed}s</span>}
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-area">
          <textarea
            className="chat-input"
            placeholder={apiReady
              ? 'Message Hermes… (Enter to send, Shift+Enter for newline)'
              : 'Enable API server to start chatting'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!apiReady || streaming}
            rows={3}
          />
          <button
            className="send-btn"
            onClick={send}
            disabled={!apiReady || streaming || !input.trim()}
          >
            {streaming ? '⏸' : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}
