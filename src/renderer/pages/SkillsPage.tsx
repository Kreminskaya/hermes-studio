import { useState, useEffect, useMemo } from 'react'
import './SkillsPage.css'

interface Skill {
  category: string
  name: string
  description: string
  tags: string[]
  version: string
  enabled: boolean
}

const CATEGORY_EMOJI: Record<string, string> = {
  apple: '🍎', agents: '🤖', 'autonomous-ai-agents': '🧠',
  'career-consultant': '💼', creative: '🎨', 'data-science': '📊',
  devops: '⚙️', diagramming: '📐', dogfood: '🐶', domain: '🌐',
  email: '📧', feeds: '📡', gaming: '🎮', gifs: '🎞️', github: '🐙',
  'inference-sh': '⚡', mcp: '🔌', media: '🎬', mlops: '🔬',
  'note-taking': '📝', productivity: '🚀', 'red-teaming': '🔴',
  research: '🔎', skills: '✨', 'smart-home': '🏠',
  'social-media': '📱', 'software-development': '💻', yuanbao: '🌸',
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    window.hermes?.skills?.().then(s => {
      setSkills(s ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  async function toggle(skill: Skill) {
    setBusy(skill.name)
    setError(null)
    const next = !skill.enabled
    // optimistic update
    setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, enabled: next } : s))
    const res = await window.hermes?.skillToggle?.(skill.name, next)
    setBusy(null)
    if (!res?.ok) {
      setError(`Не удалось переключить «${skill.name}»: ${res?.error ?? 'unknown'}`)
      setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, enabled: skill.enabled } : s)) // revert
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [skills, query])

  const enabledCount = skills.filter(s => s.enabled).length

  if (loading) return (
    <div className="skills-loading">
      <div className="skills-spinner" />
      <span>Loading skills…</span>
    </div>
  )

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div className="skills-header-left">
          <h2 className="skills-title">Skills</h2>
          <span className="skills-count">{enabledCount} enabled · {skills.length} total</span>
        </div>
        <input
          className="skills-search"
          placeholder="Search skills…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="skills-error">{error}</div>}

      <div className="skills-grid">
        {filtered.length === 0 && <div className="skills-empty">Nothing matches “{query}”.</div>}
        {filtered.map(skill => (
          <div key={`${skill.category}/${skill.name}`} className={`skill-card ${skill.enabled ? '' : 'off'}`}>
            <div className="skill-card-icon">
              {CATEGORY_EMOJI[skill.category] ?? '📦'}
            </div>
            <div className="skill-card-body">
              <div className="skill-name-row">
                <span className="skill-name">{skill.name}</span>
                <button
                  className={`switch sm ${skill.enabled ? 'on' : ''} ${busy === skill.name ? 'busy' : ''}`}
                  onClick={() => toggle(skill)}
                  disabled={busy === skill.name}
                  title={skill.enabled ? 'Disable' : 'Enable'}
                >
                  <span className="switch-knob" />
                </button>
              </div>
              {skill.description && (
                <p className="skill-desc">{skill.description}</p>
              )}
              {skill.tags.length > 0 && (
                <div className="skill-tags">
                  {skill.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="skill-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
