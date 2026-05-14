# Hermes Studio

A native macOS desktop client for the Hermes AI agent framework. Built with Electron + React, it wraps Hermes's REST and SSE APIs into a clean UI — no terminal required after first setup.

![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)
![Electron](https://img.shields.io/badge/electron-35-blue)
![React](https://img.shields.io/badge/react-19-61dafb)

---

## What it does

| Tab | Description |
|-----|-------------|
| **Chat** | Streaming chat with Hermes agents. Shows live tool progress with the agent's own emoji indicators. Session history in the sidebar. |
| **Kanban** | Real-time task board pulled from Hermes's `kanban.db`. Shows task status, assignee, run profiles, and cost. |
| **Cron** | Browse, create, enable/disable, and trigger cron jobs via Hermes API. |
| **Skills** | Visual card grid of all installed skills from `~/.hermes/skills/`. |
| **Settings** | Theme switcher (Dark / Light / Lime). |

---

## Requirements

- **macOS** (Apple Silicon, macOS 13+)
- **Hermes** installed and configured on the same machine
- **Node.js 18+** only if building from source

Hermes Studio auto-launches Hermes on startup — you don't need to run it manually.

---

## Install

### Pre-built (recommended)

Download `Hermes Studio-x.x.x-arm64.dmg` from [Releases](../../releases), open it, drag to Applications.

### Build from source

```bash
git clone https://github.com/your-org/hermes-studio.git
cd hermes-studio
npm install
npm run build
# → dist/mac-arm64/Hermes Studio.app
```

For development with hot reload:

```bash
npm run dev
```

---

## How it connects to Hermes

### Auto-launch

On startup, Hermes Studio:

1. Reads `~/.hermes/gateway_state.json` to check if Hermes is already running
2. If not — finds the `hermes` binary via `which hermes` and runs `hermes start`
3. Polls until `gateway_state` = `"running"`, then loads the UI

> **Why `gateway_state.json` and not a port check?**  
> Hermes's gateway can be running while the API server is disabled. Checking the JSON file is the only reliable source of truth.

### API server

Hermes needs its API server enabled (default port `8642`). If it's off, a banner appears with a one-click fix that:

1. Writes `API_SERVER_ENABLED=true` to `~/.hermes/.env`
2. Restarts Hermes
3. Polls `/health` until the API is up
4. Dismisses itself automatically

---

## Hermes quirks — documented fixes

These are real behavioral differences in Hermes that required workarounds in the client. If you're building another Hermes client or connecting an agent to this codebase, these may save you hours.

### 1. Cron `schedule` is an object, not a string

`GET /api/jobs` returns each job's schedule as:

```json
{ "kind": "cron", "expr": "0 9 * * *", "display": "Every day at 9am" }
```

Not a plain string. Rendering it directly in React crashes with error #31 ("Objects are not valid as a React child").

**Fix:** extract `display → expr → JSON.stringify` before rendering. See `scheduleStr()` in `CronPage.tsx`.

---

### 2. Streaming tool progress events

During agent runs, Hermes emits custom SSE events alongside standard OpenAI-compatible chunks:

```
event: hermes.tool.progress
data: {"emoji": "🔍", "tool": "web_search", "label": "Searching...", "status": "running"}
```

Standard SSE parsers ignore the `event:` line entirely. You have to track it manually.

**Fix:** maintain a `currentEvent` variable in the SSE loop. When a line starts with `event: `, store it and skip to the next line. When a `data: ` line follows, branch on `currentEvent === 'hermes.tool.progress'` before trying to parse it as an OpenAI chunk. See `ChatPage.tsx`.

---

### 3. Sending a session ID causes empty responses

Passing `X-Hermes-Session-Id` with an existing session ID causes Hermes to load history from its database **and** receive it again in the `messages` array — the duplicate context produces an empty or broken response.

**Fix:** do not send `X-Hermes-Session-Id`. Pass the full message history in the `messages` body on every request. Hermes creates a new session per exchange; the UI auto-detects and switches to it after each response.

---

### 4. Fake session IDs cause multi-minute delays

Sending a randomly generated client-side ID as `X-Hermes-Session-Id` causes Hermes to spend several minutes trying to resolve it against its database before giving up.

**Fix:** never send session IDs you didn't receive directly from Hermes's API.

---

### 5. Profile symlinks create duplicate entries in the sidebar

`~/.hermes/profiles/` may contain symlinks (e.g. `defoult → default`) left by Hermes during migrations. `fs.readdirSync` follows them, making the same profile appear twice in the list.

**Fix:** filter with `lstatSync().isSymbolicLink()` before listing profiles. See the `hermes:profiles` IPC handler in `index.ts`.

---

### 6. "Object has been destroyed" errors flooding the console

Electron's `webContents.send()` throws if called after the window is closed — this can happen inside file watcher callbacks that fire during shutdown.

**Fix:** wrap all `webContents.send()` calls in a `safeSend()` helper that guards with `!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()`. See `index.ts`.

---

## Key file paths

```
~/.hermes/
├── .env                    # API_SERVER_ENABLED, API_SERVER_PORT, API_SERVER_KEY, etc.
├── gateway_state.json      # { "gateway_state": "running", "pid": 12345, "active_agents": 2 }
├── state.db                # SQLite: sessions + messages (global)
├── kanban.db               # SQLite: tasks + task_runs
├── profiles/
│   └── <name>/
│       ├── config.yaml     # Model config — grep for "default:" to get active model name
│       └── state.db        # Per-profile sessions
└── skills/
    └── <category>/
        └── <name>/
            └── SKILL.md    # YAML frontmatter: name, description, tags, version
```

---

## Project structure

```
src/
├── main/
│   ├── index.ts            # Electron main: IPC handlers, Hermes process mgmt, SQLite queries
│   └── preload.ts          # contextBridge — exposes window.hermes API to renderer
└── renderer/
    ├── App.tsx             # Root: page routing, launch overlay, global error boundary
    ├── pages/
    │   ├── ChatPage.tsx    # Chat UI, SSE streaming, tool progress, session management
    │   ├── KanbanPage.tsx  # Task board with live stats
    │   ├── CronPage.tsx    # Cron job CRUD
    │   ├── SkillsPage.tsx  # Skills card grid
    │   └── SettingsPage.tsx
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── StatusBar.tsx
    │   ├── SetupBanner.tsx  # API server enable flow
    │   └── LaunchOverlay.tsx
    ├── hooks/
    │   └── useSession.ts    # Sessions polling + push refresh subscription
    └── styles/
        └── globals.css      # All CSS custom properties + three theme definitions
resources/
└── icon.icns                # macOS app icon
```

---

## Themes

Three themes, switchable in Settings without restart.

| Theme | Accent | Background |
|-------|--------|------------|
| Dark  | Purple/blue | `#10111a` |
| Light | Purple | `#f0eef8` |
| Lime  | Green | `#1a1a1d` |

All colors are CSS custom properties in `globals.css` — adding a new theme is a single `[data-theme="name"]` block.

---

## Using this README with an AI agent

This document is intentionally structured for machine readability. If you're using an AI agent to set up, debug, or extend Hermes Studio:

- **"Key file paths"** — complete Hermes data directory layout
- **"Hermes quirks"** — each entry is a self-contained problem description + exact fix location
- **"Project structure"** — maps every feature to its source file
- The IPC bridge is in `preload.ts`; every `window.hermes.*` call maps 1:1 to an `ipcMain.handle('hermes:*')` handler in `index.ts`
- CSS variables for all themes are in one place: `src/renderer/styles/globals.css`

---

## License

MIT
