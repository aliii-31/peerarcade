import Hyperswarm from 'hyperswarm'
import { startDiscovery } from './discovery.mjs'
import { createRooms } from './rooms.mjs'

if (typeof Hyperswarm !== 'function') throw new Error('Hyperswarm failed to load')

const topic = Bare.argv[2]
const networking = topic ? startDiscovery({
  topic,
  createSwarm: () => new Hyperswarm({ maxPeers: 8 }),
  log: (event) => console.log('[P2P]', JSON.stringify(event))
}) : null
const rooms = createRooms({
  createSwarm: () => new Hyperswarm({ maxPeers: 8 }),
  log: (event) => console.log('[Room]', JSON.stringify(event))
})
let commands = Promise.resolve()
let queued = 0
function roomCommand(line) {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (!Number.isSafeInteger(request?.id) || request.id < 1) return
  if (queued >= 16) {
    Bare.IPC.write(JSON.stringify({ id: request.id, error: 'Too many pending commands' }) + '\n')
    return
  }
  queued++
  commands = commands.then(async () => {
    try {
      if (stopping) throw new Error('Worker stopping')
      if (topic) throw new Error('Room actions are disabled in developer discovery mode. Restart without PEERARCADE_TOPIC.')
      let result
      if (request.op === 'start') result = await rooms.start(request.config || {})
      else if (request.op === 'leave') result = await rooms.leave()
      else if (request.op === 'game-state') result = rooms.gameState()
      else if (request.op === 'move') result = await rooms.move(request.config)
      else if (request.op === 'state') result = rooms.getState()
      else throw new Error('Unknown room operation')
      Bare.IPC.write(JSON.stringify({ id: request.id, result }) + '\n')
    } catch (error) {
      Bare.IPC.write(JSON.stringify({ id: request.id, error: error.message }) + '\n')
    } finally { queued-- }
  })
}
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => Bare.exit(1), 5000)
  try {
    await commands
    await rooms.leave()
    await networking?.stop()
    Bare.IPC.write('shutdown-complete\n')
    clearTimeout(deadline)
    Bare.exit(0)
  } catch {
    clearTimeout(deadline)
    Bare.exit(1)
  }
}
Bare.IPC.on('end', shutdown)
// IPC is a stream: a message may span chunks, or share a chunk with another.
let input = ''
Bare.IPC.on('data', (chunk) => {
  input += chunk.toString()
  let end
  while ((end = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (line.length > 2048) { Bare.exit(1); return }
    if (line.startsWith('{')) { roomCommand(line); continue }
    if (line === 'shutdown') { shutdown(); continue }
    if (/^ping:[1-9][0-9]{0,15}$/.test(line)) {
      Bare.IPC.write(`pong:${line.slice(5)}\n`)
    }
  }
  if (input.length > 2048) Bare.exit(1)
})
Bare.IPC.write(`PeerArcade worker ready (networking ${topic ? 'configured' : 'disabled'})\n`)
