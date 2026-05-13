// Dev runner: starts Vite, then Electron when ready
const { spawn } = require('child_process')
const { createServer } = require('net')

function waitPort(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const s = createServer()
      s.once('error', () => {
        // port is in use = Vite is ready
        resolve()
      })
      s.once('listening', () => {
        s.close()
        if (Date.now() - start > timeout) reject(new Error('timeout'))
        else setTimeout(check, 300)
      })
      s.listen(port, '127.0.0.1')
    }
    check()
  })
}

async function main() {
  const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true })

  console.log('Waiting for Vite...')
  await waitPort(5173)
  console.log('Vite ready, launching Electron...')

  // Compile main process first
  spawn('npx', ['tsc', '-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'], {
    stdio: 'inherit', shell: true
  })

  await new Promise(r => setTimeout(r, 2000))

  const electron = spawn('npx', ['electron', '.'], {
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
    shell: true,
  })

  const cleanup = () => { vite.kill(); electron.kill(); process.exit() }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  electron.on('close', cleanup)
}

main().catch(console.error)
