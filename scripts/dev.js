// Dev runner: starts Vite on port 5200, then Electron
const { spawn } = require('child_process')

const VITE_PORT = 5200

async function main() {
  // Pass port via CLI so it doesn't conflict with other Vite instances
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    stdio: 'inherit',
    shell: true,
  })

  console.log(`Waiting for Vite on port ${VITE_PORT}...`)
  await new Promise(r => setTimeout(r, 3000))
  console.log('Launching Electron...')

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
