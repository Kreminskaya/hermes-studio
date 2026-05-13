import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, watchFile } from 'fs'
import { homedir } from 'os'
import * as http from 'http'
import * as https from 'https'

const HERMES_HOME = join(homedir(), '.hermes')
const HERMES_ENV = join(HERMES_HOME, '.env')
const HERMES_CONFIG = join(HERMES_HOME, 'config.yaml')
const GATEWAY_STATE = join(HERMES_HOME, 'gateway_state.json')
const KANBAN_STATUS = join(HERMES_HOME, 'kanban-status.txt')
const API_PORT = 8642
const API_BASE = `http://127.0.0.1:${API_PORT}`

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
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

// ─── File watchers ────────────────────────────────────────────────────────────

function startFileWatchers() {
  const push = (channel: string, filePath: string) => {
    if (!existsSync(filePath)) return
    watchFile(filePath, { interval: 1000 }, () => {
      try {
        const data = readFileSync(filePath, 'utf8')
        mainWindow?.webContents.send(channel, data)
      } catch {}
    })
  }

  push('gateway:state', GATEWAY_STATE)
  push('kanban:status', KANBAN_STATUS)
}

// ─── IPC: read local Hermes files ─────────────────────────────────────────────

ipcMain.handle('hermes:gateway-state', () => {
  try {
    return JSON.parse(readFileSync(GATEWAY_STATE, 'utf8'))
  } catch {
    return null
  }
})

ipcMain.handle('hermes:kanban-status', () => {
  try {
    return readFileSync(KANBAN_STATUS, 'utf8')
  } catch {
    return ''
  }
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
  } catch {
    return {}
  }
})

ipcMain.handle('hermes:enable-api-server', (_e, apiKey?: string) => {
  try {
    let content = existsSync(HERMES_ENV) ? readFileSync(HERMES_ENV, 'utf8') : ''
    const setVar = (key: string, val: string) => {
      const re = new RegExp(`^${key}=.*$`, 'm')
      if (re.test(content)) content = content.replace(re, `${key}=${val}`)
      else content += `\n${key}=${val}`
    }
    setVar('API_SERVER_ENABLED', 'true')
    setVar('API_SERVER_PORT', String(API_PORT))
    setVar('API_SERVER_HOST', '127.0.0.1')
    setVar('API_SERVER_CORS_ORIGINS', 'http://localhost:5173')
    if (apiKey) setVar('API_SERVER_KEY', apiKey)
    writeFileSync(HERMES_ENV, content.trim() + '\n')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: proxy HTTP requests to Hermes API (no CORS needed) ─────────────────

ipcMain.handle('hermes:api', async (_e, { method, path, body, headers = {} }) => {
  return new Promise((resolve) => {
    const url = new URL(API_BASE + path)
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname + url.search,
      method: method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ ok: true, status: res.statusCode, data: JSON.parse(data) })
        } catch {
          resolve({ ok: true, status: res.statusCode, data })
        }
      })
    })

    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
})

// ─── IPC: SSE streaming via Electron net module ───────────────────────────────

ipcMain.handle('hermes:stream-start', async (_e, { path, body, headers = {} }) => {
  const runId = Math.random().toString(36).slice(2)

  const url = new URL(API_BASE + path)
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
      mainWindow?.webContents.send(`stream:${runId}`, { type: 'chunk', data: chunk })
    })
    res.on('end', () => {
      mainWindow?.webContents.send(`stream:${runId}`, { type: 'end' })
    })
  })

  req.on('error', (e) => {
    mainWindow?.webContents.send(`stream:${runId}`, { type: 'error', error: e.message })
  })

  if (body) req.write(JSON.stringify(body))
  req.end()

  return runId
})
