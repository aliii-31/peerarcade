// Diagnostic only: real production BrowserWindow, no simulated UI input.
// Parent supplies a disposable profile so existing user data is never changed.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const profile = process.env.PEERARCADE_QA_PROFILE
if (!profile || !path.isAbsolute(profile)) throw new Error('Provide an absolute disposable PEERARCADE_QA_PROFILE')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
console.log('[QA] userData=sessionData:', profile)
console.log('[QA] Electron:', process.versions.electron)
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('render-process-gone', (_event, details) => console.error('[QA] renderer gone:', details.reason))
  window.webContents.once('did-finish-load', () => {
    console.log('[QA] production window loaded; requesting normal quit in 8 seconds')
    setTimeout(() => app.quit(), 8000)
  })
})
app.on('will-quit', () => console.log('[QA] normal will-quit reached'))
const PearRuntime = require('pear-runtime')
const runWorker = PearRuntime.run
PearRuntime.run = (...args) => {
  const worker = runWorker(...args)
  worker.on('exit', code => console.log('[QA] Bare exit code:', code))
  return worker
}
require('../electron/main.js')
setTimeout(() => { console.error('[QA] startup/quit deadline exceeded'); app.exit(1) }, 20000).unref()
