import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSessions } from '../hooks/useSession'
import type { HermesSession, HermesMessage } from '../App'
import './ChatPage.css'

interface Attachment {
  type: 'image' | 'text' | 'file'
  name: string
  mime: string
  data: string
  path: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  tokens?: number
  attachments?: Attachment[]
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

// Derive a sidebar title from the first user message of a session.
// Content may be raw text or a JSON multimodal array (text + attachments).
function deriveTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let text = raw
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      const parts = Array.isArray(parsed) ? parsed : [parsed]
      const textPart = parts.find((p: any) => typeof p?.text === 'string')
      if (!textPart) return null
      text = textPart.text
    } catch { return null }
  }
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > 60 ? clean.slice(0, 60) + '…' : clean
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const activeRunIdRef = useRef<string | null>(null)
  const unsubStreamRef = useRef<(() => void) | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Local titles for API sessions (Hermes doesn't generate titles for API sessions)
  const [localTitles, setLocalTitles] = useState<Record<string, string>>(
    () => JSON.parse(localStorage.getItem('hermes_local_titles') ?? '{}')
  )

  function saveLocalTitle(sid: string, text: string) {
    const title = text.trim().slice(0, 48) + (text.trim().length > 48 ? '…' : '')
    setLocalTitles(prev => {
      const next = { ...prev, [sid]: title }
      localStorage.setItem('hermes_local_titles', JSON.stringify(next))
      return next
    })
  }

  // ID of the session that last received a response (green dot)
  const [lastActiveId, setLastActiveId] = useState<string | null>(
    () => localStorage.getItem('hermes_last_active_id')
  )
  // Set of pinned session IDs
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('hermes_pinned_ids') ?? '[]'))
  )

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
    // migrate local title from placeholder to real session ID
    setLocalTitles(prev => {
      if (!prev[localId]) return prev
      const next = { ...prev, [newest.id]: prev[localId] }
      delete next[localId]
      localStorage.setItem('hermes_local_titles', JSON.stringify(next))
      return next
    })
    // also migrate lastActiveId if it was pointing to the local placeholder
    setLastActiveId(prev => {
      if (prev === localId) {
        localStorage.setItem('hermes_last_active_id', newest.id)
        return newest.id
      }
      return prev
    })
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

  function togglePin(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem('hermes_pinned_ids', JSON.stringify([...next]))
      return next
    })
  }

  // If currentId is not in DB sessions yet, show it as pending entry at top
  const displaySessions = useMemo(() => {
    const base = (currentId && !sessions.find(s => s.id === currentId))
      ? [{ id: currentId, title: 'New chat', _pending: true } as any, ...sessions]
      : sessions
    return base
  }, [sessions, currentId])

  const pinnedSessions = useMemo(
    () => displaySessions.filter(s => pinnedIds.has(s.id)),
    [displaySessions, pinnedIds]
  )
  const unpinnedSessions = useMemo(
    () => displaySessions.filter(s => !pinnedIds.has(s.id)),
    [displaySessions, pinnedIds]
  )

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
    const currentAttachments = [...attachments]
    setInput('')
    setAttachments([])

    // Save first message as local title if session has none yet
    if (!localTitles[sid] && !(sessions.find(s => s.id === sid)?.title)) {
      saveLocalTitle(sid, userText)
    }

    setMessages(prev => ({
      ...prev,
      [sid!]: [...(prev[sid!] ?? []),
        { role: 'user', content: userText, attachments: currentAttachments.length ? currentAttachments : undefined },
        { role: 'assistant', content: '' },
      ],
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
          { role: 'user' as const, content: buildMessageContent(userText, currentAttachments) },
        ],
        stream: true,
      }

      const runId = await window.hermes?.streamStart({
        path: '/v1/chat/completions',
        body,
      })
      if (!runId) throw new Error('No run ID')
      activeRunIdRef.current = runId
      // store unsub so stopStream can call it even from outside this closure
      // (set after onStream call below — but ref is set here to mark active state)

      let buf = ''
      let totalTokens = 0
      let currentEvent = ''

      const unsub = window.hermes?.onStream(runId, (event) => {
        if (!unsubStreamRef.current) return // already stopped manually
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
        if (event.type === 'error') {
          activeRunIdRef.current = null
          unsubStreamRef.current = null
          setStreaming(false)
          unsub?.()
          patchLastMsg({ content: `Error: ${event.error ?? 'unknown error'}` })
          return
        }
        if (event.type === 'end') {
          activeRunIdRef.current = null
          unsubStreamRef.current = null
          setStreaming(false)
          unsub?.()
          if (totalTokens > 0) patchLastMsg({ tokens: totalTokens })
          // mark as last active (green dot)
          const activeId = pendingLocalIdRef.current ?? sid
          setLastActiveId(activeId)
          localStorage.setItem('hermes_last_active_id', activeId ?? '')
          // reload sessions so new/updated session appears in the list
          setTimeout(() => reloadSessions(), 400)
        }
      })
      unsubStreamRef.current = unsub ?? null
    } catch (e: any) {
      patchLastMsg({ content: `Error: ${e.message}` })
      setStreaming(false)
    }
  }

  function stopStream() {
    // Unsubscribe from stream events immediately so no more state updates
    unsubStreamRef.current?.()
    unsubStreamRef.current = null
    // Kill the underlying HTTP request if it's still active
    if (activeRunIdRef.current) {
      window.hermes?.streamStop(activeRunIdRef.current)
      activeRunIdRef.current = null
    }
    // Always clear streaming state — regardless of timing
    setStreaming(false)
    setActiveTool(null)
  }

  async function pickFile() {
    const file = await window.hermes?.showFilePicker()
    if (file) setAttachments(prev => [...prev, file as Attachment])
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  function buildMessageContent(text: string, atts: Attachment[]) {
    const images = atts.filter(a => a.type === 'image')
    const textFiles = atts.filter(a => a.type === 'text')
    const otherFiles = atts.filter(a => a.type === 'file')

    let fullText = text
    if (textFiles.length > 0) {
      fullText = textFiles.map(f => `**[${f.name}]**\n\`\`\`\n${f.data}\n\`\`\``).join('\n\n') + '\n\n' + fullText
    }
    if (otherFiles.length > 0) {
      fullText = otherFiles.map(f => `[Attached file: ${f.path}]`).join('\n') + '\n\n' + fullText
    }

    if (images.length === 0) return fullText

    return [
      { type: 'text', text: fullText },
      ...images.map(img => ({
        type: 'image_url',
        image_url: { url: `data:${img.mime};base64,${img.data}` },
      })),
    ]
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function renderSessionItem(s: any) {
    const isDb = !s._pending
    const totalTok = isDb ? ((s.input_tokens ?? 0) + (s.output_tokens ?? 0)) : 0
    const cost = isDb ? (s.actual_cost_usd ?? s.estimated_cost_usd ?? 0) : 0
    const isActive = s.id === currentId
    const isLast = s.id === lastActiveId
    const isPinned = pinnedIds.has(s.id)
    return (
      <div
        key={s.id}
        className={`session-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}`}
        onClick={() => isDb ? selectSession(s.id) : setCurrentId(s.id)}
      >
        <div className="session-title-row">
          {isLast && <span className="session-dot" title="Last active" />}
          <span className="session-title">{s.title ?? localTitles[s.id] ?? deriveTitle(s.first_user_msg) ?? 'Untitled'}</span>
          {isDb && (
            <button
              className={`session-pin-btn ${isPinned ? 'is-pinned' : ''}`}
              onClick={(e) => togglePin(s.id, e)}
              title={isPinned ? 'Unpin' : 'Pin to top'}
            >
              📌
            </button>
          )}
        </div>
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

          {/* Pinned section */}
          {pinnedSessions.length > 0 && (
            <>
              <div className="session-section-label">Pinned</div>
              {pinnedSessions.map((s: any) => renderSessionItem(s))}
              {unpinnedSessions.length > 0 && <div className="session-separator" />}
            </>
          )}

          {/* Regular sessions */}
          {unpinnedSessions.map((s: any) => renderSessionItem(s))}

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
                    {msg.attachments?.filter(a => a.type === 'image').map((a, i) => (
                      <img key={i} src={`data:${a.mime};base64,${a.data}`} className="msg-image" alt={a.name} />
                    ))}
                    {msg.content && (
                      <div
                        className="msg-content md-content"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    )}
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
          {attachments.length > 0 && (
            <div className="attachments-preview">
              {attachments.map((a, i) => (
                <div key={i} className="attach-chip">
                  {a.type === 'image'
                    ? <img src={`data:${a.mime};base64,${a.data}`} className="attach-thumb" alt={a.name} />
                    : <span className="attach-icon">{a.type === 'text' ? '📄' : '📎'}</span>
                  }
                  <span className="attach-name">{a.name}</span>
                  <button className="attach-remove" onClick={() => removeAttachment(i)}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="input-row">
            <button
              className="attach-btn"
              onClick={pickFile}
              disabled={!apiReady || streaming}
              title="Attach file or image"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
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
            {streaming
              ? <button className="stop-btn" onClick={stopStream} title="Stop">■</button>
              : <button className="send-btn" onClick={send} disabled={!apiReady || (!input.trim() && !attachments.length)}>↑</button>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
