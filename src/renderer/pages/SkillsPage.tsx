import { useState, useEffect } from 'react'
import './SkillsPage.css'

interface Skill {
  category: string
  name: string
  description: string
  tags: string[]
  version: string
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

  useEffect(() => {
    window.hermes?.skills?.().then(s => {
      setSkills(s ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="skills-loading">
      <div className="skills-spinner" />
      <span>Loading skills…</span>
    </div>
  )

  return (
    <div className="skills-page">
      <div className="skills-header">
        <h2 className="skills-title">Skills</h2>
        <span className="skills-count">{skills.length} installed</span>
      </div>
      <div className="skills-grid">
        {skills.map(skill => (
          <div key={`${skill.category}/${skill.name}`} className="skill-card">
            <div className="skill-card-icon">
              {CATEGORY_EMOJI[skill.category] ?? '📦'}
            </div>
            <div className="skill-card-body">
              <span className="skill-name">{skill.name}</span>
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
