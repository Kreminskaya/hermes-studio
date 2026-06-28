import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, readFileSync, writeFileSync, copyFileSync, watchFile, readdirSync, statSync, lstatSync } from 'fs'
import { homedir } from 'os'
import { execSync, execFileSync, spawn } from 'child_process'
import { randomBytes } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import * as http from 'http'

// Active SSE streams — keyed by runId so we can abort them
const activeStreams = new Map<string, http.ClientRequest>()

// ─── Notifications: fire a macOS notification when a Kanban task finishes ───────
let notificationsEnabled = true
const seenDoneTaskIds = new Set<string>()      // tasks we've already notified about
let doneSeedingComplete = false                // don't notify for pre-existing history

// ─── Update: single-flight guard so we never run two `hermes update`s at once ──
let updateRunning = false

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

// ─── .env parser (re-reads on every call to survive key rotation) ─────────────

function readEnv(): Record<string, string> {
  try {
    const env: Record<string, string> = {}
    for (const line of readFileSync(HERMES_ENV, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) env[m[1].trim()] = m[2].trim()
    }
    return env
  } catch { return {} }
}

// Disabled-skill names live in config.yaml under skills.disabled (Hermes's own schema)
const CONFIG_YAML = join(HERMES_HOME, 'config.yaml')
function readDisabledSkills(): Set<string> {
  try {
    const cfg = parseYaml(readFileSync(CONFIG_YAML, 'utf8')) as any
    const list = cfg?.skills?.disabled
    return new Set(Array.isArray(list) ? list : [])
  } catch { return new Set() }
}

// ─── SQLite helper (uses macOS built-in sqlite3 CLI, zero native deps) ────────

function sqliteQuery<T = unknown>(dbPath: string, sql: string): T[] {
  try {
    const escaped = sql.replace(/"/g, '\\"')
    // Use full path so the query works when launched from Launchpad/Finder
    const sqlite3 = ['/usr/bin/sqlite3', '/opt/homebrew/bin/sqlite3'].find(p => existsSync(p)) ?? 'sqlite3'
    const out = execSync(`"${sqlite3}" -json "${dbPath}" "${escaped}"`, {
      timeout: 5000,
      encoding: 'utf8',
    })
    return out.trim() ? JSON.parse(out) as T[] : []
  } catch {
    return []
  }
}

// ─── Task-completion notifications ───────────────────────────────────────────

interface DoneTask { id: string; title: string | null; assignee: string | null; status: string }

function fetchDoneTasks(): DoneTask[] {
  if (!existsSync(KANBAN_DB)) return []
  return sqliteQuery<DoneTask>(KANBAN_DB,
    'SELECT id, title, assignee, status FROM tasks WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 60')
}

// Seed the "already seen" set on startup so we only notify about NEW completions.
function seedDoneTasks() {
  for (const t of fetchDoneTasks()) seenDoneTaskIds.add(t.id)
  doneSeedingComplete = true
}

// Called whenever kanban.db changes — fire a notification for newly finished tasks.
function checkTaskCompletions() {
  if (!doneSeedingComplete) return
  for (const t of fetchDoneTasks()) {
    if (seenDoneTaskIds.has(t.id)) continue
    seenDoneTaskIds.add(t.id)
    if (!notificationsEnabled || !Notification.isSupported()) continue
    const n = new Notification({
      title: '✓ Task finished',
      body: t.title ? `${t.title}${t.assignee ? ` · ${t.assignee}` : ''}` : 'A Kanban task just completed',
      silent: false,
    })
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
        safeSend('navigate', 'kanban')
      }
    })
    n.show()
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

  hermesProcess = spawn(bin, ['gateway', 'run', '--replace'], {
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
  // Remember which tasks are already finished so we only notify on new completions
  seedDoneTasks()

  // gateway state → push JSON
  if (existsSync(GATEWAY_STATE)) {
    watchFile(GATEWAY_STATE, { interval: 1000 }, () => {
      try { safeSend('gateway:state', readFileSync(GATEWAY_STATE, 'utf8')) } catch {}
    })
  }

  // kanban.db → push refreshed tasks + fire completion notifications
  if (existsSync(KANBAN_DB)) {
    watchFile(KANBAN_DB, { interval: 2000 }, () => {
      try { safeSend('kanban:refresh') } catch {}
      try { checkTaskCompletions() } catch {}
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

ipcMain.handle('hermes:read-env', () => readEnv())

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
    setVar('API_SERVER_CORS_ORIGINS', 'http://localhost:5200')
    const existingKey = readEnv()['API_SERVER_KEY']
    const resolvedKey = apiKey || existingKey || randomBytes(32).toString('hex')
    setVar('API_SERVER_KEY', resolvedKey)
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
  const disabled = readDisabledSkills()
  const skills: { category: string; name: string; description: string; tags: string[]; version: string; enabled: boolean }[] = []

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
          const name = (fm.name as string) || skillName
          skills.push({
            category: cat,
            name,
            description: (fm.description as string) || '',
            tags: (fm.tags as string[]) || [],
            version: (fm.version as string) || '',
            enabled: !disabled.has(name) && !disabled.has(skillName),
          })
        } catch {}
      }
    }
  } catch {}

  return skills
})

// ─── IPC: enable/disable a skill ────────────────────────────────────────────────
// Writes config.skills.disabled using Hermes's OWN load_config/save_disabled_skills
// (same path the official dashboard uses) so we never mangle her heavy config.yaml.
// A pre-write backup (config.yaml.studio-bak) is the safety net.

ipcMain.handle('hermes:skill-toggle', (_e, name: string, enable: boolean) => {
  try {
    if (!name || typeof name !== 'string') return { ok: false, error: 'invalid skill name' }
    const py = [
      join(HERMES_HOME, 'hermes-agent', 'venv', 'bin', 'python3'),
      join(HERMES_HOME, 'hermes-agent', 'venv', 'bin', 'python'),
    ].find(p => existsSync(p))
    if (!py) return { ok: false, error: 'Hermes venv python not found' }

    try { if (existsSync(CONFIG_YAML)) copyFileSync(CONFIG_YAML, CONFIG_YAML + '.studio-bak') } catch {}

    const script = [
      'import sys',
      'from hermes_cli.config import load_config',
      'from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills',
      'name, action = sys.argv[1], sys.argv[2]',
      'c = load_config()',
      'd = get_disabled_skills(c)',
      "(d.discard if action == 'enable' else d.add)(name)",
      'save_disabled_skills(c, d)',
      "print('OK')",
    ].join('\n')

    const out = execFileSync(py, ['-c', script, name, enable ? 'enable' : 'disable'], {
      cwd: join(HERMES_HOME, 'hermes-agent'),
      env: { ...process.env, HOME: homedir() },
      encoding: 'utf8',
      timeout: 15000,
    })
    return { ok: /OK/.test(out), name, enabled: enable }
  } catch (e: any) {
    return { ok: false, error: (e.stderr && e.stderr.toString()) || e.message }
  }
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
    '       input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, model,',
    '       (SELECT m.content FROM messages m WHERE m.session_id = sessions.id',
    "        AND m.role = 'user' ORDER BY m.timestamp ASC LIMIT 1) AS first_user_msg",
    'FROM sessions',
    "WHERE source != 'cron'",
    'ORDER BY started_at DESC',
    `LIMIT ${limit}`,
  ].join(' '))
})

// Full session history for the History page — all sources, with `source` for filtering.
ipcMain.handle('hermes:sessions-history', (_e, limit = 500) => {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000)
  return sqliteQuery(STATE_DB, [
    'SELECT id, source, title, started_at, ended_at, message_count, tool_call_count,',
    '       input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, model,',
    "       (SELECT m.content FROM messages m WHERE m.session_id = sessions.id",
    "        AND m.role = 'user' ORDER BY m.timestamp ASC LIMIT 1) AS first_user_msg",
    'FROM sessions',
    'ORDER BY started_at DESC',
    `LIMIT ${lim}`,
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
  const cols = [
    'SELECT t.id, t.title, t.body, t.assignee, t.status, t.priority,',
    '       t.created_at, t.started_at, t.completed_at, t.worker_pid,',
    '       t.consecutive_failures, t.last_failure_error,',
    '       r.profile as run_profile, r.status as run_status, r.outcome,',
    '       r.started_at as run_started_at, r.ended_at as run_ended_at',
    'FROM tasks t',
    'LEFT JOIN task_runs r ON r.id = t.current_run_id',
  ].join(' ')

  const active   = sqliteQuery<Record<string, unknown>>(KANBAN_DB,
    `${cols} WHERE t.status != 'archived' ORDER BY COALESCE(t.started_at, t.created_at) DESC LIMIT 100`)
  const archived = sqliteQuery<Record<string, unknown>>(KANBAN_DB,
    `${cols} WHERE t.status = 'archived' ORDER BY COALESCE(t.started_at, t.created_at) DESC LIMIT 5`)

  return [...active, ...archived]
})

ipcMain.handle('hermes:kanban-stats', () => {
  return sqliteQuery(KANBAN_DB,
    'SELECT status, assignee, COUNT(*) as count FROM tasks GROUP BY status, assignee')
})

// ─── IPC: Hermes version + update awareness ─────────────────────────────────────
// Single source of truth for "what Hermes are we running" — surfaced in the UI so
// Studio stays honest across Hermes's frequent rolling updates.

ipcMain.handle('hermes:hermes-version', () => {
  try {
    const bin = findHermesBin()
    if (!bin) return { ok: false, error: 'hermes not found in PATH' }
    // `hermes --version` reads its cached update-check, so this is fast (no network).
    const out = execSync(`"${bin}" --version`, { encoding: 'utf8', timeout: 8000 }).trim()
    // e.g. "Hermes Agent v0.17.0 (2026.6.19) · upstream 190e1ffa\n…\nUp to date"
    const m = out.match(/Hermes Agent\s+v([^\s]+)\s*\(([^)]*)\)(?:\s*·\s*upstream\s+([0-9a-f]+))?/i)
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
    const lastLine = lines[lines.length - 1] ?? ''
    const upToDate = /up to date/i.test(lastLine)
    return {
      ok: true,
      version: m?.[1] ?? null,
      build: m?.[2] ?? null,
      upstream: m?.[3] ?? null,
      status: lastLine,
      updateAvailable: !upToDate && /update|behind|available|new version/i.test(lastLine),
    }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: check for a Hermes update (fresh git fetch) ───────────────────────────

ipcMain.handle('hermes:update-check', () => {
  try {
    const bin = findHermesBin()
    if (!bin) return { ok: false, error: 'hermes not found in PATH' }
    const out = execSync(`"${bin}" update --check`, { encoding: 'utf8', timeout: 30000 }).trim()
    const upToDate = /up to date|already.*latest|no update/i.test(out)
    const behind = out.match(/(\d+)\s+commits?\s+behind/i)
    return {
      ok: true,
      available: !upToDate && /update available|behind|new version/i.test(out),
      behind: behind ? Number(behind[1]) : null,
      raw: out,
    }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: run `hermes update` and stream progress to the renderer ───────────────
// Always with --backup (a full ~/.hermes zip) so the user can roll back. Mutating,
// so it's behind an explicit button + confirmation in the UI.

ipcMain.handle('hermes:update-run', () => {
  if (updateRunning) return { ok: false, error: 'Update already in progress' }
  const bin = findHermesBin()
  if (!bin) return { ok: false, error: 'hermes not found in PATH' }

  updateRunning = true
  safeSend('hermes:update-progress', { line: '→ Running: hermes update --backup --yes' })

  const proc = spawn(bin, ['update', '--backup', '--yes'], {
    env: { ...process.env, HOME: homedir() },
  })
  const onData = (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      const l = line.replace(/\s+$/, '')
      if (l.trim()) safeSend('hermes:update-progress', { line: l })
    }
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  proc.on('close', (code) => {
    updateRunning = false
    safeSend('hermes:update-done', { ok: code === 0, code })
  })
  proc.on('error', (err) => {
    updateRunning = false
    safeSend('hermes:update-done', { ok: false, error: err.message })
  })

  return { ok: true, started: true }
})

// ─── IPC: notification preferences ──────────────────────────────────────────────

ipcMain.handle('hermes:set-notifications', (_e, enabled: boolean) => {
  notificationsEnabled = !!enabled
  return { ok: true, enabled: notificationsEnabled }
})

ipcMain.handle('hermes:test-notification', () => {
  if (!Notification.isSupported()) return { ok: false, error: 'Notifications not supported' }
  new Notification({ title: 'Hermes Studio', body: 'Notifications are working ✓' }).show()
  return { ok: true }
})

// ─── IPC: Insights — aggregated usage analytics from state.db (read-only) ────────
// DeepSeek runs make cost ≈ 0, so tokens + activity are the headline metrics here.

ipcMain.handle('hermes:insights', () => {
  const cost = 'COALESCE(actual_cost_usd, estimated_cost_usd, 0)'

  const totals = sqliteQuery<Record<string, number>>(STATE_DB, [
    'SELECT COUNT(*) AS sessions,',
    'COALESCE(SUM(input_tokens),0) AS input_tokens,',
    'COALESCE(SUM(output_tokens),0) AS output_tokens,',
    'COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,',
    'COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,',
    'COALESCE(SUM(tool_call_count),0) AS tool_calls,',
    'COALESCE(SUM(message_count),0) AS messages,',
    `COALESCE(SUM(${cost}),0) AS cost_usd`,
    'FROM sessions',
  ].join(' '))

  const byModel = sqliteQuery(STATE_DB, [
    'SELECT model,',
    'COUNT(*) AS sessions,',
    'COALESCE(SUM(input_tokens),0) AS input_tokens,',
    'COALESCE(SUM(output_tokens),0) AS output_tokens,',
    'COALESCE(SUM(input_tokens + output_tokens),0) AS total_tokens,',
    `COALESCE(SUM(${cost}),0) AS cost_usd`,
    "FROM sessions WHERE model IS NOT NULL AND model != ''",
    'GROUP BY model ORDER BY total_tokens DESC LIMIT 12',
  ].join(' '))

  const bySource = sqliteQuery(STATE_DB, [
    'SELECT source, COUNT(*) AS sessions,',
    'COALESCE(SUM(input_tokens + output_tokens),0) AS total_tokens',
    'FROM sessions GROUP BY source ORDER BY sessions DESC',
  ].join(' '))

  const daily = sqliteQuery(STATE_DB, [
    "SELECT date(started_at, 'unixepoch', 'localtime') AS day,",
    'COUNT(*) AS sessions,',
    'COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,',
    `COALESCE(SUM(${cost}),0) AS cost_usd`,
    "FROM sessions WHERE started_at >= strftime('%s', 'now', '-30 days')",
    'GROUP BY day ORDER BY day ASC',
  ].join(' '))

  return { totals: totals[0] ?? {}, byModel, bySource, daily }
})

// ─── IPC: HTTP proxy to Hermes API ────────────────────────────────────────────

ipcMain.handle('hermes:api', async (_e, { method, path, body, headers = {} }) => {
  return new Promise((resolve) => {
    const url  = new URL(API_BASE + path)
    const apiKey = readEnv()['API_SERVER_KEY']
    const authHeader: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname + url.search,
      method: method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...authHeader, ...headers },
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
  const apiKey = readEnv()['API_SERVER_KEY']
  const authHeader: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  const opts: http.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...authHeader,
      ...headers,
    },
  }
  const req = http.request(opts, (res) => {
    const ct = res.headers['content-type'] ?? ''
    if (res.statusCode !== 200 || !ct.includes('text/event-stream')) {
      // Non-SSE response — collect body and forward as error
      let errBody = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (errBody += c))
      res.on('end', () => {
        activeStreams.delete(runId)
        const detail = errBody.slice(0, 512) || `HTTP ${res.statusCode}`
        safeSend(`stream:${runId}`, { type: 'error', error: detail })
      })
      return
    }
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      safeSend(`stream:${runId}`, { type: 'chunk', data: chunk })
    })
    res.on('end', () => {
      activeStreams.delete(runId)
      safeSend(`stream:${runId}`, { type: 'end' })
    })
  })
  req.on('error', e => {
    activeStreams.delete(runId)
    // If destroyed intentionally — send 'end' not 'error' so UI cleans up gracefully
    if ((e as any).code === 'ECONNRESET' || (e as any).destroyed) {
      safeSend(`stream:${runId}`, { type: 'end' })
    } else {
      safeSend(`stream:${runId}`, { type: 'error', error: e.message })
    }
  })
  if (body) req.write(JSON.stringify(body))
  req.end()
  activeStreams.set(runId, req)
  return runId
})

ipcMain.handle('hermes:stream-stop', (_e, runId: string) => {
  const req = activeStreams.get(runId)
  if (req) { req.destroy(); activeStreams.delete(runId) }
})

// File picker + reader
const IMAGE_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const TEXT_EXTS   = new Set(['.txt', '.md', '.json', '.csv', '.py', '.ts', '.tsx', '.js', '.jsx', '.yaml', '.yml'])

ipcMain.handle('hermes:show-file-picker', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Text & Code', extensions: ['txt', 'md', 'json', 'csv', 'py', 'ts', 'tsx', 'js', 'yaml', 'yml'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return null
  const filePath = result.filePaths[0]
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath)

  if (IMAGE_EXTS.has(ext)) {
    const data = readFileSync(filePath).toString('base64')
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
               : ext === '.png' ? 'image/png'
               : ext === '.gif' ? 'image/gif'
               : 'image/webp'
    return { type: 'image', name, mime, data, path: filePath }
  }

  if (TEXT_EXTS.has(ext)) {
    const data = readFileSync(filePath, 'utf8')
    return { type: 'text', name, mime: 'text/plain', data, path: filePath }
  }

  // PDF и прочие — возвращаем путь, пусть модель сама разберётся
  return { type: 'file', name, mime: 'application/octet-stream', data: filePath, path: filePath }
})
