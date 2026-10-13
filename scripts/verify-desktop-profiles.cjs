// Startup/cache investigation, NOT a visual or gameplay E2E test.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peerarcade-qa-'))
function launch(label, profile) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PEERARCADE_QA_PROFILE: profile }
    delete env.PEERARCADE_TOPIC
    const child = spawn(electron, [path.join(__dirname, 'qa-desktop.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => process.stdout.write(`[${label}] ${chunk}`))
    child.stderr.on('data', chunk => process.stderr.write(`[${label}] ${chunk}`))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      console.log(`[${label}] exit=${code} signal=${signal}`)
      code === 0 ? resolve() : reject(new Error(`${label} failed`))
    })
  })
}
async function run() {
  console.log('Shared disposable profile comparison')
  await Promise.all([launch('shared-A', path.join(root, 'shared')), launch('shared-B', path.join(root, 'shared'))])
  console.log('Independent disposable profiles comparison')
  await Promise.all([launch('isolated-A', path.join(root, 'A')), launch('isolated-B', path.join(root, 'B'))])
  console.log('PASS: four production windows loaded and exited normally; inspect stderr separately for cache errors')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => {
  // Keep the diagnostic directory for investigation; never touch normal app data.
  console.log('Disposable QA profiles retained at:', root)
})
