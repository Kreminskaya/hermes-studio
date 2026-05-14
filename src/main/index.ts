import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, watchFile, readdirSync, statSync, lstatSync } from 'fs'
import { homedir } from 'os'
import { execSync, spawn } from 'child_process'
import * as http from 'http'

const HERMES_HOME = join(homedir(), '.hermes')
const HERMES_ENV  = join(HERMES_HOME, '.env')
const GATEWAY_STATE = join(HERMES_HOME, 'gateway_state.json')
const KANBAN_STATUS = join(HERMES_HOME, 'kanban-status.txt')
const KANBAN_DB   = join(HERMES_HOME, 'kanban.db')
const STATE_DB    = join(HERMES_HOME, 'state.db')
const PROFILES_DIR = join(HERMES_HOME, 'profiles')
const API_PORT    = 8642
const API_BASE    = `http://127.0.0.1:${API_PORT}`
const isDev       = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null
let hermesProcess: ReturnType<typeof spawn> | null = null

function safeSend(channel: string, ...args: unknown[]) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  } catch {}
}

// ─── SQLite helper (uses macOS built-in sqlite3 CLI, zero native deps) ────────

function sqliteQuery<T = unknown>(dbPath: string, sql: string): T[] {
  try {
    const escaped = sql.replace(/"/g, '\\"')
    const out = execSync(`sqlite3 -json "${dbPath}" "${escaped}"`, {
      timeout: 5000,
      encoding: 'utf8',
    })
    return out.trim() ? JSON.parse(out) as T[] : []
  } catch {
    return []
  }
}

// ─── Hermes auto-launch ────────────────────────────────────────────────────────

function findHermesBin(): string | null {
  const candidates = [
    join(homedir(), '.local', 'bin', 'hermes'),
    join(homedir(), '.cargo', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    '/opt/homebrew/bin/hermes',
    '/usr/bin/hermes',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // Try PATH
  try {
    const out = execSync('which hermes', { encoding: 'utf8', timeout: 3000 }).trim()
    if (out) return out
  } catch {}
  return null
}

function isHermesRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: API_PORT,
      path: '/health',
      method: 'GET',
      timeout: 1500,
    }, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

function sendHermesStatus(status: string, detail?: string) {
  safeSend('hermes:launch-status', { status, detail })
}

function isGatewayRunning(): boolean {
  try {
    if (!existsSync(GATEWAY_STATE)) return false
    const state = JSON.parse(readFileSync(GATEWAY_STATE, 'utf8'))
    return state?.gateway_state === 'running'
  } catch { return false }
}

async function ensureHermesRunning() {
  // If gateway is already up (even without API server) → no need to spawn
  if (isGatewayRunning()) {
    sendHermesStatus('running')
    return
  }

  const already = await isHermesRunning()
  if (already) {
    sendHermesStatus('running')
    return
  }

  sendHermesStatus('starting', 'Ищем Hermes...')

  const bin = findHermesBin()
  if (!bin) {
    sendHermesStatus('error', 'Hermes не найден. Установите его и перезапустите Studio.')
    return
  }

  sendHermesStatus('starting', 'Starting Hermes...')

  hermesProcess = spawn(bin, ['start'], {
    detached: false,
    stdio: 'ignore',
    env: { ...process.env, HOME: homedir() },
  })

  hermesProcess.on('error', (err) => {
    sendHermesStatus('error', `Не удалось запустить: ${err.message}`)
  })

  // Poll until API responds, up to 30 seconds
  let attempts = 0
  const interval = setInterval(async () => {
    attempts++
    const up = await isHermesRunning()
    if (up) {
      clearInterval(interval)
      sendHermesStatus('running')
    } else if (attempts >= 30) {
      clearInterval(interval)
      sendHermesStatus('error', 'Hermes не запустился за 30 секунд.')
    } else {
      sendHermesStatus('starting', `Ожидаем API... (${attempts}/30)`)
    }
  }, 1000)
}

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#08090f',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5200')
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Start Hermes after window is ready so we can send status messages
  mainWindow.webContents.once('did-finish-load', () => {
    ensureHermesRunning()
  })
}

app.whenReady().then(() => {
  createWindow()
  startFileWatchers()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (hermesProcess) {
    hermesProcess.kill('SIGTERM')
    hermesProcess = null
  }
})

// ─── File watchers ─────────────────────────────────────────────────────────────

function startFileWatchers() {
  // gateway state → push JSON
  if (existsSync(GATEWAY_STATE)) {
    watchFile(GATEWAY_STATE, { interval: 1000 }, () => {
      try { safeSend('gateway:state', readFileSync(GATEWAY_STATE, 'utf8')) } catch {}
    })
  }

  // kanban.db → push refreshed tasks
  if (existsSync(KANBAN_DB)) {
    watchFile(KANBAN_DB, { interval: 2000 }, () => {
      try { safeSend('kanban:refresh') } catch {}
    })
  }

  // state.db → push sessions refresh
  if (existsSync(STATE_DB)) {
    watchFile(STATE_DB, { interval: 3000 }, () => {
      try { safeSend('sessions:refresh') } catch {}
    })
  }
}

// ─── IPC: gateway + env ────────────────────────────────────────────────────────

ipcMain.handle('hermes:gateway-state', () => {
  try { return JSON.parse(readFileSync(GATEWAY_STATE, 'utf8')) } catch { return null }
})

ipcMain.handle('hermes:read-env', () => {
  try {
    const lines = readFileSync(HERMES_ENV, 'utf8').split('\n')
    const env: Record<string, string> = {}
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) env[m[1].trim()] = m[2].trim()
    }
    return env
  } catch { return {} }
})

ipcMain.handle('hermes:enable-api-server', (_e, apiKey?: string) => {
  try {
    let content = existsSync(HERMES_ENV) ? readFileSync(HERMES_ENV, 'utf8') : ''
    const setVar = (key: string, val: string) => {
      const re = new RegExp(`^${key}=.*$`, 'm')
      content = re.test(content) ? content.replace(re, `${key}=${val}`) : content + `\n${key}=${val}`
    }
    setVar('API_SERVER_ENABLED', 'true')
    setVar('API_SERVER_PORT', String(API_PORT))
    setVar('API_SERVER_HOST', '127.0.0.1')
    setVar('API_SERVER_CORS_ORIGINS', 'http://localhost:5173')
    if (apiKey) setVar('API_SERVER_KEY', apiKey)
    writeFileSync(HERMES_ENV, content.trim() + '\n')
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e.message } }
})

// IPC: restart Hermes (for after enable-api-server)
ipcMain.handle('hermes:restart', async () => {
  // Kill our spawned process if any
  if (hermesProcess) {
    hermesProcess.kill('SIGTERM')
    hermesProcess = null
  }

  // Also kill the existing Hermes by PID from gateway_state.json
  try {
    if (existsSync(GATEWAY_STATE)) {
      const state = JSON.parse(readFileSync(GATEWAY_STATE, 'utf8'))
      if (state?.pid) {
        process.kill(state.pid, 'SIGTERM')
      }
    }
  } catch {}

  // Try hermes stop command as well
  const bin = findHermesBin()
  if (bin) {
    try { execSync(`"${bin}" stop`, { timeout: 5000 }) } catch {}
  }

  await new Promise(r => setTimeout(r, 2000))
  await ensureHermesRunning()
  return { ok: true }
})

// IPC: manual check
ipcMain.handle('hermes:check-running', async () => {
  const running = await isHermesRunning()
  return { running }
})

// ─── IPC: skills ───────────────────────────────────────────────────────────────

ipcMain.handle('hermes:skills', () => {
  const SKILLS_DIR = join(HERMES_HOME, 'skills')
  const skills: { category: string; name: string; description: string; tags: string[]; version: string }[] = []

  function parseFrontmatter(md: string): Record<string, unknown> {
    const m = md.match(/^---\n([\s\S]*?)\n---/)
    if (!m) return {}
    const obj: Record<string, unknown> = {}
    for (const line of m[1].split('\n')) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const key = line.slice(0, colon).trim()
      const val = line.slice(colon + 1).trim()
      if (val.startsWith('[') && val.endsWith(']')) {
        obj[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
      } else {
        obj[key] = val.replace(/^["']|["']$/g, '')
      }
    }
    return obj
  }

  try {
    const categories = readdirSync(SKILLS_DIR).filter(f => {
      try { return statSync(join(SKILLS_DIR, f)).isDirectory() } catch { return false }
    })
    for (const cat of categories) {
      const catDir = join(SKILLS_DIR, cat)
      const entries = readdirSync(catDir).filter(f => {
        try { return statSync(join(catDir, f)).isDirectory() } catch { return false }
      })
      for (const skillName of entries) {
        const skillMd = join(catDir, skillName, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        try {
          const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'))
          skills.push({
            category: cat,
            name: (fm.name as string) || skillName,
            description: (fm.description as string) || '',
            tags: (fm.tags as string[]) || [],
            version: (fm.version as string) || '',
          })
        } catch {}
      }
    }
  } catch {}

  return skills
})

// ─── IPC: profiles ─────────────────────────────────────────────────────────────

ipcMain.handle('hermes:profiles', () => {
  try {
    return readdirSync(PROFILES_DIR)
      .filter(name => {
        try { return statSync(join(PROFILES_DIR, name)).isDirectory() && !lstatSync(join(PROFILES_DIR, name)).isSymbolicLink() } catch { return false }
      })
      .map(name => {
      const profileHome = join(PROFILES_DIR, name)
      const configPath  = join(profileHome, 'config.yaml')
      const statePath   = join(profileHome, 'state.db')
      let model = 'unknown'
      if (existsSync(configPath)) {
        const m = readFileSync(configPath, 'utf8').match(/default:\s*(.+)/)
        if (m) model = m[1].trim()
      }
      // session count from this profile's own state.db
      let sessionCount = 0
      if (existsSync(statePath)) {
        const rows = sqliteQuery<{ n: number }>(statePath, 'SELECT COUNT(*) as n FROM sessions')
        sessionCount = rows[0]?.n ?? 0
      }
      return { name, model, sessionCount }
    })
  } catch { return [] }
})

// ─── IPC: real sessions from state.db ─────────────────────────────────────────

ipcMain.handle('hermes:sessions', (_e, limit = 40) => {
  return sqliteQuery(STATE_DB, [
    'SELECT id, title, started_at, ended_at, message_count, tool_call_count,',
    '       input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, model',
    'FROM sessions',
    'ORDER BY started_at DESC',
    `LIMIT ${limit}`,
  ].join(' '))
})

ipcMain.handle('hermes:session-messages', (_e, sessionId: string) => {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '')
  return sqliteQuery(STATE_DB, [
    'SELECT id, role, content, tool_name, tool_calls, timestamp, token_count',
    'FROM messages',
    `WHERE session_id = '${safe}'`,
    'ORDER BY timestamp ASC',
  ].join(' '))
})

// ─── IPC: real kanban tasks from kanban.db ─────────────────────────────────────

ipcMain.handle('hermes:kanban-tasks', () => {
  const tasks = sqliteQuery<Record<string, unknown>>(KANBAN_DB, [
    'SELECT t.id, t.title, t.body, t.assignee, t.status, t.priority,',
    '       t.created_at, t.started_at, t.completed_at, t.worker_pid,',
    '       t.consecutive_failures, t.last_failure_error,',
    '       r.profile as run_profile, r.status as run_status, r.outcome,',
    '       r.started_at as run_started_at, r.ended_at as run_ended_at',
    'FROM tasks t',
    'LEFT JOIN task_runs r ON r.id = t.current_run_id',
    'ORDER BY COALESCE(t.started_at, t.created_at) DESC',
    'LIMIT 100',
  ].join(' '))
  return tasks
})

ipcMain.handle('hermes:kanban-stats', () => {
  return sqliteQuery(KANBAN_DB,
    'SELECT status, assignee, COUNT(*) as count FROM tasks GROUP BY status, assignee')
})

// ─── IPC: HTTP proxy to Hermes API ────────────────────────────────────────────

ipcMain.handle('hermes:api', async (_e, { method, path, body, headers = {} }) => {
  return new Promise((resolve) => {
    const url  = new URL(API_BASE + path)
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname + url.search,
      method: method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => {
        try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ ok: true, status: res.statusCode, data }) }
      })
    })
    req.on('error', e => resolve({ ok: false, error: e.message }))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
})

// ─── IPC: SSE streaming ────────────────────────────────────────────────────────

ipcMain.handle('hermes:stream-start', async (_e, { path, body, headers = {} }) => {
  const runId = Math.random().toString(36).slice(2)
  const url   = new URL(API_BASE + path)
  const opts: http.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...headers,
    },
  }
  const req = http.request(opts, (res) => {
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      safeSend(`stream:${runId}`, { type: 'chunk', data: chunk })
    })
    res.on('end', () => {
      safeSend(`stream:${runId}`, { type: 'end' })
    })
  })
  req.on('error', e => {
    safeSend(`stream:${runId}`, { type: 'error', error: e.message })
  })
  if (body) req.write(JSON.stringify(body))
  req.end()
  return runId
})
