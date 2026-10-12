// Validate that the future networking dependency loads under Bare.
// Health checks are local only: never construct a swarm or join a topic here.
import Hyperswarm from 'hyperswarm'

if (typeof Hyperswarm !== 'function') throw new Error('Hyperswarm failed to load')

Bare.IPC.on('end', () => Bare.exit(0))
// IPC is a stream: a message may span chunks, or share a chunk with another.
let input = ''
Bare.IPC.on('data', (chunk) => {
  input += chunk.toString()
  let end
  while ((end = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (/^ping:[1-9][0-9]{0,15}$/.test(line)) {
      Bare.IPC.write(`pong:${line.slice(5)}\n`)
    }
  }
  if (input.length > 64) Bare.exit(1)
})
Bare.IPC.write('PeerArcade worker ready (networking disabled)\n')
