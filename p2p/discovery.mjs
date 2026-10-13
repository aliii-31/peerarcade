// Runtime-independent lifecycle wrapper; the Bare entry point supplies Hyperswarm.
export function startDiscovery({ topic, createSwarm, log }) {
  let swarm
  let stopping
  const peers = new Set()
  const report = (event, details = {}) => log({ event, ...details })
  const error = (where, err) => report('error', { where, message: String(err?.message || err) })
  try {
    if (!/^[a-f0-9]{64}$/.test(topic)) throw new Error('Expected a 32-byte hexadecimal topic')
    const key = Uint8Array.from(topic.match(/../g), (byte) => parseInt(byte, 16))
    swarm = createSwarm()
    swarm.on('error', (err) => error('swarm', err))
    swarm.dht.on('error', (err) => error('dht', err))
    swarm.on('ban', (_peer, err) => error('connection-attempt', err))
    swarm.on('connection', (socket) => {
      const peer = Array.from(socket.remotePublicKey, (byte) => byte.toString(16).padStart(2, '0')).join('')
      peers.add(socket)
      report('connected', { peer, count: peers.size })
      socket.on('error', (err) => error('socket', err))
      socket.once('close', () => {
        peers.delete(socket)
        report('disconnected', { peer, count: peers.size })
      })
      // No application protocol yet; drain unsolicited data without retaining it.
      socket.resume()
    })
    report('discovering', { topic })
    const discovery = swarm.join(key, { client: true, server: true })
    Promise.resolve(discovery.flushed()).then(() => {
      if (!stopping) report('announced', { topic })
    }).catch((err) => error('announce', err))
  } catch (err) {
    error('startup', err)
  }
  return {
    stop() {
      if (!stopping) {
        stopping = Promise.resolve().then(async () => {
          if (swarm) await swarm.destroy()
          report('stopped')
        }).catch((err) => { error('shutdown', err); throw err })
      }
      return stopping
    }
  }
}
