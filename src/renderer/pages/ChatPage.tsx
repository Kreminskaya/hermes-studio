import { useState, useEffect, useRef } from 'react'
import { useSessions } from '../hooks/useSession'
import './ChatPage.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
  tokens?: number
  cost?: number
}

interface Props {
  apiReady: boolean
}

// rough cost estimate (DeepSeek pricing as default)
function estimateCost(tokens: number) {
  return tokens * 0.00000014
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

export default function ChatPage({ apiReady }: Props) {
  const { sessions, active, activeId, setActiveId, newSession, updateSession, deleteSession } = useSessions()
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [models, setModels] = useState<string[]>(['hermes-agent'])
  const [model, setModel] = useState('hermes-agent')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { loadModels() }, [apiReady])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, activeId])

  async function loadModels() {
    if (!apiReady) return
    const res = await window.hermes?.api({ path: '/v1/models' })
    if (res?.ok && Array.isArray((res.data as any)?.data)) {
      setModels((res.data as any).data.map((m: any) => m.id))
    }
  }

  const currentMessages = activeId ? (messages[activeId] ?? []) : []

  function appendMsg(sessionId: string, msg: Message) {
    setMessages(prev => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), msg],
    }))
  }

  function patchLastMsg(sessionId: string, patch: Partial<Message>) {
    setMessages(prev => {
      const list = [...(prev[sessionId] ?? [])]
      if (list.length === 0) return prev
      list[list.length - 1] = { ...list[list.length - 1], ...patch }
      return { ...prev, [sessionId]: list }
    })
  }

  async function send() {
    if (!input.trim() || streaming || !apiReady) return

    let session = active
    if (!session) session = newSession()

    const sid = session.id
    const userText = input.trim()
    setInput('')

    appendMsg(sid, { role: 'user', content: userText })
    appendMsg(sid, { role: 'assistant', content: '' })
    setStreaming(true)

    // Update session title from first message
    const msgs = messages[sid] ?? []
    if (msgs.length === 0) {
      updateSession(sid, { title: userText.slice(0, 40), lastAt: Date.now() })
    } else {
      updateSession(sid, { lastAt: Date.now() })
    }

    try {
      // Build history for this session
      const history = [...(messages[sid] ?? [])].filter(m => m.role !== 'assistant' || m.content)
      const allMsgs = [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userText },
      ]

      const body = {
        model,
        messages: allMsgs,
        stream: true,
      }

      const headers: Record<string, string> = {
        'X-Hermes-Session-Id': sid,
        'X-Hermes-Session-Key': sid,
      }

      const runId = await window.hermes?.streamStart({ path: '/v1/chat/completions', body, headers })
      if (!runId) throw new Error('No run ID')

      let buffer = ''
      let totalTokens = 0

      const unsub = window.hermes?.onStream(runId, (event) => {
        if (event.type === 'chunk' && event.data) {
          // Parse SSE lines
          const lines = (buffer + event.data).split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') continue
            try {
              const parsed = JSON.parse(raw)
              const delta = parsed.choices?.[0]?.delta?.content ?? ''
              if (delta) {
                setMessages(prev => {
                  const list = [...(prev[sid] ?? [])]
                  const last = list[list.length - 1]
                  if (last?.role === 'assistant') {
                    list[list.length - 1] = { ...last, content: last.content + delta }
                  }
                  return { ...prev, [sid]: list }
                })
              }
              if (parsed.usage) {
                totalTokens = parsed.usage.total_tokens ?? totalTokens
              }
            } catch {}
          }
        }

        if (event.type === 'end' || event.type === 'error') {
          setStreaming(false)
          unsub?.()
          const cost = estimateCost(totalTokens)
          patchLastMsg(sid, { tokens: totalTokens, cost })
          updateSession(sid, {
            tokens: (active?.tokens ?? 0) + totalTokens,
            cost: (active?.cost ?? 0) + cost,
            lastAt: Date.now(),
          })
        }
      })
    } catch (e: any) {
      patchLastMsg(sid, { content: `Error: ${e.message}` })
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat-layout">
      {/* Session sidebar */}
      <div className="session-list">
        <button className="new-chat-btn" onClick={() => newSession()}>
          + New chat
        </button>
        <div className="sessions-scroll">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              <span className="session-title">{s.title}</span>
              <div className="session-meta">
                {s.tokens > 0 && (
                  <span className="session-tokens">{s.tokens.toLocaleString()} tok</span>
                )}
                <button
                  className="session-del"
                  onClick={e => { e.stopPropagation(); deleteSession(s.id) }}
                  title="Delete"
                >×</button>
              </div>
            </div>
          ))}
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
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {active && (
            <span className="chat-stats">
              {active.tokens > 0 && `${active.tokens.toLocaleString()} tokens · $${active.cost.toFixed(4)}`}
            </span>
          )}
        </div>

        <div className="messages-area">
          {!active && (
            <div className="empty-state">
              <div className="empty-icon">🤖</div>
              <p>Start a new chat or select a session</p>
            </div>
          )}
          {currentMessages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="msg-avatar">{msg.role === 'user' ? 'You' : 'H'}</div>
              <div className="msg-body">
                <div
                  className="msg-content md-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
                {msg.tokens && msg.tokens > 0 && (
                  <div className="msg-meta">
                    {msg.tokens.toLocaleString()} tokens · ${msg.cost?.toFixed(5)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="streaming-indicator">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-area">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={apiReady ? 'Message Hermes… (Enter to send, Shift+Enter for newline)' : 'Enable API server to start chatting'}
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
