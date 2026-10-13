const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { createHash } = require('node:crypto')
const PearRuntime = require('pear-runtime')

const { createWorkerClient } = require('./worker-client')
const { pathToFileURL } = require('node:url')

let worker
let workerClient
let quitting = false

app.whenReady().then(async () => {
  // Topic configuration belongs to the developer environment, not the renderer API.
  const topic = process.env.PEERARCADE_TOPIC
  const args = topic ? [createHash('sha256').update(topic).digest('hex')] : []
  worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'), args)
  workerClient = createWorkerClient(worker)
  worker.on('data', (data) => console.log('[Bare]', data.toString().trim()))
  worker.stdout.on('data', (data) => console.log(data.toString().trim()))
  worker.stderr.on('data', (data) => console.error('[Bare]', data.toString()))

  const window = new BrowserWindow({
    title: 'PeerArcade',
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const rendererURL = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  ipcMain.handle('peerarcade:check-worker', async (event, ...args) => {
    if (event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== rendererURL || args.length !== 0) {
      throw new Error('Unauthorized worker check')
    }
    try {
      return await workerClient.ping()
    } catch {
      return { status: 'unavailable', reply: null }
    }
  })
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  console.log('PeerArcade window loaded')
}).catch((error) => {
  console.error('PeerArcade failed to start:', error)
  app.exit(1)
})

app.on('before-quit', (event) => {
  if (quitting || !worker || worker.destroyed) return
  event.preventDefault()
  quitting = true
  ipcMain.removeHandler('peerarcade:check-worker')
  const deadline = setTimeout(() => {
    console.error('Worker shutdown timed out; forcing cleanup')
    workerClient.close()
    app.exit(1)
  }, 6000)
  worker.once('close', () => {
    clearTimeout(deadline)
    workerClient.close()
    app.quit()
  })
  worker.write('shutdown\n')
})
app.on('window-all-closed', () => app.quit())
