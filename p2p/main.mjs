// Validate that the future networking dependency loads under Bare.
// Do not construct a swarm or join a topic in this setup issue.
import Hyperswarm from 'hyperswarm'

if (typeof Hyperswarm !== 'function') throw new Error('Hyperswarm failed to load')

Bare.IPC.on('end', () => Bare.exit(0))
Bare.IPC.resume()
Bare.IPC.write('PeerArcade worker ready (networking disabled)\n')
