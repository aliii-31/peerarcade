const { contextBridge, ipcRenderer } = require('electron')

// Fixed operations only; joining accepts one invitation, never arbitrary IPC channels.
contextBridge.exposeInMainWorld('peerArcade', {
  checkWorker: () => ipcRenderer.invoke('peerarcade:check-worker'),
  createRoom: () => ipcRenderer.invoke('peerarcade:create-room'),
  joinRoom: invitation => ipcRenderer.invoke('peerarcade:join-room', invitation),
  leaveRoom: () => ipcRenderer.invoke('peerarcade:leave-room'),
  roomState: () => ipcRenderer.invoke('peerarcade:room-state'),
  gameState: () => ipcRenderer.invoke('peerarcade:game-state'),
  requestMove: request => ipcRenderer.invoke('peerarcade:game-move', request),
  copyInvitation: () => ipcRenderer.invoke('peerarcade:copy-invitation')
})
