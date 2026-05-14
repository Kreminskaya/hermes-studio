import './SettingsPage.css'

export type Theme = 'dark' | 'light' | 'gray'

interface Props {
  theme: Theme
  onTheme: (t: Theme) => void
}

const THEMES: { id: Theme; label: string; desc: string; preview: [string, string] }[] = [
  {
    id: 'dark',
    label: 'Deep Space',
    desc: 'Чёрный фон, фиолетовый акцент',
    preview: ['#08090f', '#7c6fff'],
  },
  {
    id: 'light',
    label: 'Light',
    desc: 'Светлый фон, лавандовый акцент',
    preview: ['#f0eef8', '#6c5fff'],
  },
  {
    id: 'gray',
    label: 'Lime & Raspberry',
    desc: 'Серый фон, лайм и малина',
    preview: ['#1a1a1d', '#a3e635'],
  },
]

export default function SettingsPage({ theme, onTheme }: Props) {
  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="settings-title">Settings</h2>
      </div>

      <div className="settings-body">
        <section className="settings-section">
          <h3 className="section-title">Appearance</h3>
          <p className="section-sub">Choose a color theme for the interface</p>

          <div className="theme-grid">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`theme-card ${theme === t.id ? 'active' : ''}`}
                onClick={() => onTheme(t.id)}
              >
                {/* Mini preview */}
                <div className="theme-preview" style={{ background: t.preview[0] }}>
                  <div className="preview-sidebar" />
                  <div className="preview-content">
                    <div
                      className="preview-bar"
                      style={{ background: t.preview[1], opacity: 0.9 }}
                    />
                    <div className="preview-lines">
                      <div className="preview-line long" />
                      <div className="preview-line short" />
                      <div className="preview-line medium" />
                    </div>
                  </div>
                  {theme === t.id && (
                    <div className="preview-check" style={{ background: t.preview[1] }}>✓</div>
                  )}
                </div>

                <div className="theme-info">
                  <span className="theme-label">{t.label}</span>
                  <span className="theme-desc">{t.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
