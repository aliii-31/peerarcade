import Hyperswarm from 'hyperswarm'
import { startDiscovery } from './discovery.mjs'

if (typeof Hyperswarm !== 'function') throw new Error('Hyperswarm failed to load')

const topic = Bare.argv[2]
const networking = topic ? startDiscovery({
  topic,
  createSwarm: () => new Hyperswarm({ maxPeers: 8 }),
  log: (event) => console.log('[P2P]', JSON.stringify(event))
}) : null
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => Bare.exit(1), 5000)
  try {
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
    if (line === 'shutdown') { shutdown(); continue }
    if (/^ping:[1-9][0-9]{0,15}$/.test(line)) {
      Bare.IPC.write(`pong:${line.slice(5)}\n`)
    }
  }
  if (input.length > 64) Bare.exit(1)
})
Bare.IPC.write(`PeerArcade worker ready (networking ${topic ? 'configured' : 'disabled'})\n`)
