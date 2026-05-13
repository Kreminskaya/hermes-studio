# Hermes Studio

A clean desktop GUI for [Hermes Agent](https://github.com/NousResearch/hermes-agent) — built with Electron + React + TypeScript.

![Hermes Studio](resources/screenshot.png)

## Why another wrapper?

Existing wrappers either spawn new `AIAgent` instances directly (breaking sessions, causing 15-minute API timeouts) or wrap the CLI subprocess (duplicating processes and state). Hermes Studio takes a different approach:

**It talks to Hermes through its own REST API.** Zero process interference.

## Features

- **Chat** — streaming responses via SSE, proper session continuity (`X-Hermes-Session-Id`), model selector, per-session token & cost tracking
- **Kanban** — live view of the agent's task board from `~/.hermes/kanban-status.txt`, auto-refreshes on file change
- **Cron** — view, create, pause, delete, and run scheduled agent jobs via `/api/jobs`
- **Setup wizard** — detects when the Hermes API server isn't enabled and writes the config for you
- **Status bar** — live gateway state, API port, PID

## Architecture

```
Electron Main Process (Node.js)
  ├── HTTP client → Hermes REST API (localhost:8642)
  ├── SSE streaming → forwarded to renderer via IPC
  └── File watcher → kanban-status.txt, gateway_state.json

React Renderer (TypeScript)
  ├── Chat page   — sessions stored in localStorage, no duplicates
  ├── Kanban page — reads from live file watcher
  └── Cron page   — CRUD via /api/jobs endpoints
```

All API calls go through the Electron main process — no CORS config needed, API keys stay in main.

## Prerequisites

1. [Hermes Agent](https://github.com/NousResearch/hermes-agent) v0.12+
2. Enable the API server in `~/.hermes/.env`:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_PORT=8642
   API_SERVER_HOST=127.0.0.1
   ```
   Or click **"Enable API Server"** in the app — it writes this for you.
3. Restart Hermes after enabling.

## Getting started

```bash
# Install dependencies
npm install

# Development (starts Vite + Electron)
npm run dev

# Build distributable
npm run build
```

## Session management

Sessions are stored in `localStorage` — each conversation gets a stable ID sent as `X-Hermes-Session-Id`. No duplicate sessions, no session confusion. Closing and reopening the app preserves your chat history.

## Stack

- **Electron 35** — desktop shell
- **React 19 + TypeScript** — UI
- **Vite 6** — bundler
- **Zero UI framework** — pure CSS custom properties, no Tailwind, no shadcn

## License

MIT
