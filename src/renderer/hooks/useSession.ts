import { useState, useEffect } from 'react'
import type { HermesSession } from '../App'

export type { HermesSession }

export function useSessions() {
  const [sessions, setSessions] = useState<HermesSession[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    const data = await window.hermes?.sessions(60)
    if (data) setSessions(data)
    setLoading(false)
  }

  useEffect(() => {
    reload()
    const unsub = window.hermes?.onSessionsRefresh(reload)
    return () => unsub?.()
  }, [])

  return { sessions, loading, reload }
}
