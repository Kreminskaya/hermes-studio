<div align="center">

# 🖥️ Hermes Studio

### A native macOS app for [Hermes](https://github.com/nikvdp/hermes) AI agents

> Streaming chat · Session history · Usage insights · Live Kanban · Cron control · Skills · Three themes · No terminal needed.

<br/>

![Hermes Studio Demo](./resources/demo.gif)

<br/>

[![GitHub stars](https://img.shields.io/github/stars/Kreminskaya/hermes-studio?style=social)](https://github.com/Kreminskaya/hermes-studio/stargazers)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-black?style=flat-square&logo=apple)
![Electron](https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)

</div>

---

## 🎯 Who is this for?

You run **Hermes AI agents** on your Mac. You know what Hermes can do — but you're tired of:

- Juggling terminal windows and scrolling through logs to see what's happening
- Zero visibility into what multiple agents are doing simultaneously
- Losing your chat context every time you switch tabs or close a session
- No way to stop an agent mid-run when it goes off track

If that's you — Hermes Studio was built for you.

---

## ✨ Features

### 💬 Chat
A proper chat interface with everything you'd expect from a modern AI client.

- **Live streaming** with real-time tool-progress indicators (see every step the agent takes)
- **Stop button** — interrupt the agent the moment it starts going off-track
- **File & image attachments** — drop screenshots, documents, code files directly in chat
- **Pinned sessions** — keep important chats at the top of the sidebar
- **Last-active indicator** — green dot marks where the agent last responded
- **Auto-named sessions** — chats are titled from your first message, not "Untitled"
- **Tab-safe history** — switching to Kanban and back doesn't wipe your chat state

### 🕘 History
A searchable archive of every session Hermes has ever run on your Mac.

- Search across titles, first messages and models
- Filter by source (CLI, API, Cron, Subagent) with live counts
- Click any session to read its full message transcript in a side panel

### 📊 Insights
Usage analytics pulled straight from your session history.

- Totals for sessions, tokens, tool calls, cache reads and estimated cost
- 30-day activity chart
- Breakdowns by model and by source

### 📋 Kanban
A live board showing exactly what every agent is working on right now.

- Pulls directly from Hermes's `kanban.db` — no polling lag
- Shows task status, assignee, run duration, and live activity indicator
- Archived tasks visible for reference (last 5 per board)
- One-click refresh

### ⏰ Cron
A full control panel for scheduled agent jobs — no config file required.

- Pause, resume, run-now, create and delete jobs
- Rich per-job status: last result (ok / error), run count, next-run countdown
- Human-readable schedule display

### ✨ Skills
Browse every installed Hermes skill in a searchable card grid — and toggle each one on or off.

- Search by name, description, category or tag
- Enable / disable individual skills right from the grid
- Shows how many skills are currently active

### ⚙️ Settings
- **In-app updates** — check for and install new Hermes releases, with live progress
- **Task notifications** — native macOS alerts when an agent finishes a Kanban task
- **Three themes:** Dark, Light, Lime — switch instantly, no restart required
- Live runtime version shown in the sidebar

---

## 🚀 Quick Start

### Download (recommended)

Grab the latest `Hermes Studio-x.x.x-arm64.dmg` from [Releases](../../releases), open it, drag to Applications.

### Build from source

```bash
git clone https://github.com/Kreminskaya/hermes-studio.git
cd hermes-studio
npm install
npm run build
cp -R "dist/mac-arm64/Hermes Studio.app" /Applications/
```

**Development mode** (hot reload):
```bash
npm run dev
```

---

## 📸 Screenshots

<div align="center">
  <img src="./resources/screenshot-chat.png" alt="Chat with streaming" width="700"/>
  <p><em>Chat — live streaming with tool progress indicators</em></p>
</div>

<div align="center">
  <img src="./resources/screenshot-kanban.png" alt="Live Kanban board" width="700"/>
  <p><em>Kanban — see what every agent is doing right now</em></p>
</div>

<div align="center">
  <img src="./resources/screenshot-skills.png" alt="Skills browser" width="700"/>
  <p><em>Skills — browse all installed Hermes skills</em></p>
</div>

<div align="center">
  <img src="./resources/screenshot-settings.png" alt="Three themes" width="700"/>
  <p><em>Dark · Light · Lime & Raspberry — three carefully designed themes</em></p>
</div>

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron 35 |
| UI | React 19 + TypeScript |
| Styling | CSS custom properties (3 themes) |
| Main process | Node.js |
| Data | SQLite (via Hermes runtime) |
| Build | electron-builder |

---

## ⚙️ Requirements

- **macOS** — Apple Silicon (M1 / M2 / M3 / M4)
- **macOS 13 Ventura** or later
- **[Hermes](https://github.com/nikvdp/hermes)** installed and accessible in your PATH

> Hermes Studio auto-launches Hermes on startup and waits until the API is ready. You don't need to manage it manually.

---

## 🔧 First Launch

On first launch, Hermes Studio will:
1. Auto-start Hermes if it's not already running
2. Check if the API server is enabled
3. If not — show a setup banner with a one-click fix

To enable the API server manually, add to `~/.hermes/.env`:
```
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
```

---

## 👤 Agent Profiles

Hermes Studio works with Hermes's standard profile system at `~/.hermes/profiles/`. Each profile is a YAML file that defines which model and tools an agent gets.

A multi-agent setup that works well:

**`default`** — Orchestrator. Receives requests, delegates to specialists, manages Kanban:
```yaml
toolsets:
  - kanban
agent:
  reasoning_effort: high
```

**`architect`** — Builds, writes, codes. Needs file access and terminal:
```yaml
toolsets:
  - web
  - browser
  - file
  - terminal
  - memory
  - skills
agent:
  max_turns: 40
```

**`researcher`** — Deep research with real-time web access:
```yaml
toolsets:
  - web
  - browser
  - file
  - memory
agent:
  max_turns: 40
  reasoning_effort: max
  system_prompt: |
    Always run `date` in terminal first to confirm today's real date.
    Never assume dates from training data.
```

> **Tip:** Without `toolsets: [kanban]` in the orchestrator profile, the agent won't see Kanban tools and will try to search the internet for how to create tasks. Always set it explicitly.

---

## 🎨 Themes

| | Theme | Accent | Feel |
|--|-------|--------|------|
| 🌑 | **Dark** | Purple / blue | Deep space, focused |
| ☀️ | **Light** | Purple | Clean, minimal |
| 🟢 | **Lime** | Lime green | High contrast, energetic |

All colors are CSS custom properties — adding a new theme is a single `[data-theme="name"]` block in `globals.css`.

---

## 🗺️ Roadmap

- [x] Streaming chat with real-time tool progress
- [x] Live Kanban board (reads from Hermes SQLite)
- [x] Cron control — pause/resume/run/create with per-job status
- [x] Skills browser with enable/disable toggles
- [x] Searchable session history with transcript viewer
- [x] Usage insights (tokens, cost, models, activity)
- [x] In-app Hermes updates with live progress
- [x] Native notifications when an agent finishes a task
- [x] Three themes (Dark, Light, Lime)
- [x] File & image attachments in chat
- [x] Stop button — interrupt agent mid-run
- [x] Pinned sessions + last-active indicator
- [ ] Multi-profile switcher in UI
- [ ] Windows / Linux support

---

<details>
<summary><strong>🔍 For Developers — Hermes API Quirks</strong></summary>

Real behavioral differences in Hermes that required workarounds. Documented here for anyone building another Hermes client.

### 1. Cron `schedule` is an object, not a string
`GET /api/jobs` returns schedule as:
```json
{ "kind": "cron", "expr": "0 9 * * *", "display": "Every day at 9am" }
```
Rendering it directly crashes React (error #31). **Fix:** extract `display → expr → JSON.stringify`.

### 2. Custom SSE event types
Hermes emits `event: hermes.tool.progress` alongside standard chunks. Standard parsers ignore the `event:` line. **Fix:** track `currentEvent` manually in the SSE loop.

### 3. Session ID in headers causes empty responses
`X-Hermes-Session-Id` causes Hermes to load DB history AND receive it again in the body — duplicate context produces empty responses. **Fix:** never send this header. Pass full history in the request body every time.

### 4. Fake session IDs cause multi-minute delays
A random client-side ID triggers a DB lookup that blocks for several minutes. **Fix:** never send IDs not received directly from the Hermes API.

### 5. API sessions don't get auto-titled
REST API sessions (`api-xxxxxxxx`) never receive generated titles — only CLI sessions do. **Fix:** save the first user message as a local title in `localStorage`.

### 6. Profile symlinks duplicate sidebar entries
`~/.hermes/profiles/` may contain migration symlinks. `readdirSync` follows them. **Fix:** filter with `lstatSync().isSymbolicLink()`.

### 7. SQLite binary path in packaged app
When launched from Launchpad/Finder, PATH may not include Homebrew. **Fix:** resolve `sqlite3` explicitly — `/usr/bin/sqlite3` first, Homebrew as fallback.

</details>

<details>
<summary><strong>📁 Project Structure</strong></summary>

```
src/
├── main/
│   ├── index.ts        # IPC handlers, Hermes process mgmt, SQLite queries
│   └── preload.ts      # contextBridge — exposes window.hermes to renderer
└── renderer/
    ├── App.tsx         # Root: routing, launch overlay, error boundary
    ├── pages/
    │   ├── ChatPage.tsx      # Chat, SSE streaming, attachments, sessions
    │   ├── KanbanPage.tsx    # Task board
    │   ├── CronPage.tsx      # Cron CRUD
    │   ├── SkillsPage.tsx    # Skills grid
    │   └── SettingsPage.tsx
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── StatusBar.tsx
    │   ├── SetupBanner.tsx   # API server enable flow
    │   └── LaunchOverlay.tsx
    ├── hooks/
    │   └── useSession.ts     # Sessions polling + push refresh
    └── styles/
        └── globals.css       # CSS custom properties + all three themes
resources/
└── icon.icns
```

</details>

---

## 🤝 Contributing

Issues and PRs are welcome.
Please test UI changes across all three themes before submitting.

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Built with ❤️ by Natalie Kreminskaya

⭐ If Hermes Studio is useful — a star helps others find it!

</div>
