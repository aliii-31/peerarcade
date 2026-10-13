// Test-only entry point. Production worker API has no transport-interruption command.
import Hyperswarm from 'hyperswarm'
const sockets = new Set()
const emit = Hyperswarm.prototype.emit
Hyperswarm.prototype.emit = function (event, ...args) {
  if (event === 'connection') {
    const socket = args[0]
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  }
  return emit.call(this, event, ...args)
}
let input = ''
Bare.IPC.on('data', chunk => {
  input += chunk.toString()
  let end
  while ((end = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, end); input = input.slice(end + 1)
    if (line === 'qa-interrupt') {
      const count = sockets.size
      for (const socket of sockets) socket.destroy()
      Bare.IPC.write(`qa-interrupted:${count}\n`)
    }
  }
  if (input.length > 2048) input = ''
})
await import('../p2p/main.mjs')
