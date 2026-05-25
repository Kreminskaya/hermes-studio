<div align="center">

# Hermes Studio

**A native macOS desktop client for the [Hermes](https://github.com/nikvdp/hermes) AI agent framework.**

Built with Electron + React. Turns Hermes into a real desktop app — no terminal required.

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-black?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

<!-- TODO: Add screenshot or GIF here -->

</div>

---

## What is this?

Hermes is a powerful AI agent runtime — but it lives in the terminal. Hermes Studio wraps it in a clean, native macOS GUI with real-time streaming, a visual Kanban board for agent tasks, cron job management, and more.

You get the full power of Hermes agents with the comfort of a proper desktop app.

---

## Features

### 💬 Chat
- Streaming responses with live tool-progress indicators
- Attach images and files directly in the chat
- **Stop button** — interrupt the agent mid-response at any time
- Sessions sidebar with pinned chats and last-active indicator
- Auto-names new chats from your first message
- Full message history preserved when switching tabs

### 📋 Kanban
- Real-time task board pulled directly from Hermes's `kanban.db`
- Shows task status, assignee, run profile, and duration
- Active tasks show a live running indicator
- One-click refresh

### ⏰ Cron
- Browse, create, enable/disable, and trigger cron jobs
- Human-readable schedule display
- Manual trigger button per job

### 📚 Skills
- Visual card grid of all installed Hermes skills
- Grouped by category with description, tags, and version

### ⚙️ Settings
- Three themes: **Dark**, **Light**, **Lime** — switch without restart

---

## Requirements

- **macOS** with Apple Silicon (M1 / M2 / M3 / M4)
- **macOS 13 Ventura** or later
- **[Hermes](https://github.com/nikvdp/hermes)** installed and configured

> Hermes Studio auto-launches Hermes on startup. You don't need to run it manually.

---

## Install

### Pre-built (recommended)

Download `Hermes Studio-x.x.x-arm64.dmg` from [Releases](../../releases), open it, drag to Applications.

### Build from source

```bash
git clone https://github.com/YOUR_USERNAME/hermes-studio.git
cd hermes-studio
npm install
npm run build
```

Then copy to Applications:
```bash
cp -R "dist/mac-arm64/Hermes Studio.app" /Applications/
```

For development with hot reload:
```bash
npm run dev
```

---

## Hermes Setup

Hermes Studio needs Hermes's API server enabled. On first launch, if it's not running, a setup banner appears with a one-click fix.

To enable manually, add this to `~/.hermes/.env`:
```
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
```

Then restart Hermes.

---

## Agent Profiles

Hermes Studio works with standard Hermes profiles at `~/.hermes/profiles/`. A few profile configurations that work well:

**Orchestrator** (the `default` profile) — routes tasks, manages Kanban:
```yaml
toolsets:
  - kanban
agent:
  reasoning_effort: high
```

**Architect** — writes code and documents:
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

**Researcher** — deep web research:
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
    Always run `date` in terminal first to get the real current date.
```

---

## Hermes Quirks — Documented Fixes

Real behavioral differences in Hermes that required workarounds in the client. Useful if you're building another Hermes client.

### 1. Cron `schedule` is an object, not a string

`GET /api/jobs` returns each job's schedule as:
```json
{ "kind": "cron", "expr": "0 9 * * *", "display": "Every day at 9am" }
```
Rendering it directly in React crashes with error #31. **Fix:** extract `display → expr → JSON.stringify` before rendering.

### 2. Custom SSE event types

During agent runs, Hermes emits `event: hermes.tool.progress` lines alongside standard chunks. Standard SSE parsers ignore the `event:` line entirely. **Fix:** track a `currentEvent` variable manually in the SSE loop and branch on it.

### 3. Session ID in headers causes empty responses

Passing `X-Hermes-Session-Id` with an existing ID causes Hermes to load history from its database and also receive it in the `messages` array — the duplicate produces an empty or broken response. **Fix:** never send `X-Hermes-Session-Id`. Pass the full message history in the request body every time.

### 4. Fake session IDs cause multi-minute delays

A randomly generated client-side ID sent as `X-Hermes-Session-Id` triggers a database lookup that blocks for several minutes. **Fix:** never send session IDs you didn't receive directly from the Hermes API.

### 5. API sessions don't get auto-titled

Sessions created via the REST API never receive auto-generated titles — only CLI sessions do. **Fix:** store the first user message as a local title in `localStorage`, keyed by session ID.

### 6. Profile symlinks create duplicate sidebar entries

`~/.hermes/profiles/` may contain symlinks left by migrations. `readdirSync` follows them and duplicates profiles in the list. **Fix:** filter with `lstatSync().isSymbolicLink()`.

### 7. SQLite binary path in packaged app

When launched from Launchpad or Finder, the app's `PATH` may not include Homebrew. **Fix:** resolve the `sqlite3` binary path explicitly — `/usr/bin/sqlite3` first, Homebrew as fallback.

---

## Key File Paths

```
~/.hermes/
├── .env                    # API_SERVER_ENABLED, API_SERVER_PORT, API_SERVER_KEY
├── gateway_state.json      # { "gateway_state": "running", "pid": 12345 }
├── state.db                # SQLite: sessions + messages
├── kanban.db               # SQLite: tasks + task_runs
├── profiles/
│   └── <name>/
│       └── config.yaml     # Model, toolsets, agent settings per profile
└── skills/
    └── <category>/
        └── <name>/
            └── SKILL.md    # Skill definition with YAML frontmatter
```

---

## Project Structure

```
src/
├── main/
│   ├── index.ts            # Electron main: IPC handlers, Hermes process mgmt, SQLite
│   └── preload.ts          # contextBridge — exposes window.hermes API to renderer
└── renderer/
    ├── App.tsx             # Root: routing, launch overlay, global error boundary
    ├── pages/
    │   ├── ChatPage.tsx    # Chat UI, SSE streaming, file attachments, session sidebar
    │   ├── KanbanPage.tsx  # Real-time task board
    │   ├── CronPage.tsx    # Cron job CRUD
    │   ├── SkillsPage.tsx  # Skills card grid
    │   └── SettingsPage.tsx
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── StatusBar.tsx
    │   ├── SetupBanner.tsx  # API server enable flow
    │   └── LaunchOverlay.tsx
    ├── hooks/
    │   └── useSession.ts   # Sessions polling + push refresh
    └── styles/
        └── globals.css     # All CSS custom properties + three theme definitions
resources/
└── icon.icns
```

---

## Themes

| Theme | Accent | Background |
|-------|--------|------------|
| Dark  | Purple / blue | `#10111a` |
| Light | Purple | `#f0eef8` |
| Lime  | Lime green | `#1a1a1d` |

All colors are CSS custom properties — adding a new theme is a single `[data-theme="name"]` block in `globals.css`.

---

## Contributing

Issues and PRs are welcome. Please test any UI changes across all three themes.

---

## License

MIT
