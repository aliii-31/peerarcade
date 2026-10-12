const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const PearRuntime = require('pear-runtime')

let worker

app.whenReady().then(async () => {
  // Pear Runtime supplies Bare; the worker does not start any networking yet.
  worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'))
  worker.on('data', (data) => console.log('[Bare]', data.toString().trim()))
  worker.stderr.on('data', (data) => console.error('[Bare]', data.toString()))
  worker.on('error', (error) => {
    console.error('Bare worker failed:', error)
    app.exit(1)
  })

  const window = new BrowserWindow({
    title: 'PeerArcade',
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  console.log('PeerArcade window loaded')
}).catch((error) => {
  console.error('PeerArcade failed to start:', error)
  app.exit(1)
})

app.on('before-quit', () => worker?.destroy())
app.on('window-all-closed', () => app.quit())
