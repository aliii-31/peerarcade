const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const PearRuntime = require('pear-runtime')

const { createWorkerClient } = require('./worker-client')
const { pathToFileURL } = require('node:url')

let worker
let workerClient

app.whenReady().then(async () => {
  // Pear Runtime supplies Bare; the worker does not start any networking yet.
  worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'))
  workerClient = createWorkerClient(worker)
  worker.on('data', (data) => console.log('[Bare]', data.toString().trim()))
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

app.on('before-quit', () => {
  ipcMain.removeHandler('peerarcade:check-worker')
  workerClient?.close()
})
app.on('window-all-closed', () => app.quit())
