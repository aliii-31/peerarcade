// Test-only fault injection and resource counters; never loaded by the desktop app.
import Hyperswarm from 'hyperswarm'
const sockets = new Set(), timers = new Set()
for (const [setName, clearName, repeats] of [['setTimeout', 'clearTimeout', false], ['setInterval', 'clearInterval', true]]) {
  const originalSet = globalThis[setName], originalClear = globalThis[clearName]
  globalThis[setName] = (callback, delay, ...args) => {
    const caller = new Error().stack.split('\n')[2] || ''
    const tracked = /p2p\/(rooms|game-sync)\.mjs/.test(caller)
    const handle = originalSet(() => { if (!repeats) timers.delete(handle); callback(...args) }, delay)
    if (tracked) timers.add(handle)
    return handle
  }
  globalThis[clearName] = handle => { timers.delete(handle); return originalClear(handle) }
}
let blocked = false, drop = null, history = null
function observe(line) {
  try {
    const m = JSON.parse(line)
    const moves = m.type === 'ready' ? m.state?.moves : m.type === 'game-state' ? m.moves : null
    if (Array.isArray(moves)) history = [...moves]
  } catch {}
}
const emit = Hyperswarm.prototype.emit
Hyperswarm.prototype.emit = function (event, ...args) {
  if (event === 'connection') {
    const socket = args[0]
    if (blocked) { socket.on('error', () => {}); socket.destroy(); return false }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let received = ''
    socket.on('data', chunk => {
      received += chunk.toString()
      let end
      while ((end = received.indexOf('\n')) !== -1) { observe(received.slice(0,end)); received = received.slice(end+1) }
      if (received.length > 2048) received = ''
    })
    const write = socket.write.bind(socket)
    socket.write = (data, ...rest) => {
      if (drop && String(data).includes(`"type":"${drop}"`)) { drop = null; return true }
      observe(String(data))
      return write(data, ...rest)
    }
  }
  return emit.call(this, event, ...args)
}
let input = ''
Bare.IPC.on('data', chunk => {
  input += chunk.toString()
  let end
  while ((end = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, end); input = input.slice(end + 1)
    if (!line.startsWith('qa-')) continue
    const count = sockets.size
    if (line === 'qa-block') blocked = true
    if (line === 'qa-unblock') blocked = false
    if (line === 'qa-drop-move') drop = 'game-move'
    if (line === 'qa-drop-state') drop = 'game-state'
    if (line === 'qa-interrupt' || line === 'qa-block') for (const socket of sockets) socket.destroy()
    Bare.IPC.write('qa-result:' + JSON.stringify(line === 'qa-interrupt' ? count : { sockets: sockets.size, timers: timers.size, blocked, history }) + '\n')
  }
  if (input.length > 2048) input = ''
})
await import('../p2p/main.mjs')
