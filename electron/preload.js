const { contextBridge, ipcRenderer } = require('electron')

// No arbitrary channels, payloads, Electron events, or Node APIs cross this bridge.
contextBridge.exposeInMainWorld('peerArcade', {
  checkWorker: () => ipcRenderer.invoke('peerarcade:check-worker')
})
