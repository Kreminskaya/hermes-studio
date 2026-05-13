import { useState, useEffect } from 'react'

export interface Session {
  id: string
  title: string
  createdAt: number
  lastAt: number
  tokens: number
  cost: number
}

const STORAGE_KEY = 'hermes_sessions'

function load(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function save(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(load)
  const [activeId, setActiveId] = useState<string | null>(null)

  function newSession(): Session {
    const s: Session = {
      id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'New chat',
      createdAt: Date.now(),
      lastAt: Date.now(),
      tokens: 0,
      cost: 0,
    }
    setSessions(prev => {
      const next = [s, ...prev]
      save(next)
      return next
    })
    setActiveId(s.id)
    return s
  }

  function updateSession(id: string, patch: Partial<Session>) {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...patch } : s)
      save(next)
      return next
    })
  }

  function deleteSession(id: string) {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      save(next)
      return next
    })
    if (activeId === id) setActiveId(null)
  }

  const active = sessions.find(s => s.id === activeId) ?? null

  return { sessions, active, activeId, setActiveId, newSession, updateSession, deleteSession }
}
