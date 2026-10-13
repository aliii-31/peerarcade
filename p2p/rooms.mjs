import { createGameSync } from './game-sync.mjs'
import { startDiscovery } from './discovery.mjs'
import { hex, nonce, proof, verifyProof, isHex32 } from './room-proof.mjs'

// One room and one admitted remote participant per worker.
export function createRooms({ createSwarm, log = () => {}, joinTimeout = 45000, handshakeTimeout = 10000, refreshInterval = 5000 }) {
  let state = { status: 'idle', role: null, message: 'Not in a room' }
  let session = null
  const getState = () => ({ ...state })
  const publish = (status, message) => {
    state = { status, role: session?.role || null, message }
    log({ event: 'room-state', status, role: state.role })
  }

  async function leave() {
    const old = session
    session = null // Ignore callbacks from the old swarm before awaiting cleanup.
    if (old) {
      old.game?.close()
      clearTimeout(old.deadline)
      clearInterval(old.refresh)
      for (const socket of old.sockets) socket.destroy()
      try { await old.discovery?.stop() }
      catch { publish('idle', 'Room closed; network cleanup reported an error'); throw new Error('Room cleanup failed') }
    }
    publish('idle', 'Not in a room')
    return getState()
  }

  async function start({ role, secret, topic }) {
    if (!['host', 'guest'].includes(role) || !/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(topic)) {
      throw new Error('Invalid room configuration')
    }
    if (session) throw new Error('Leave the current room first')
    const room = { role, secret, sockets: new Set(), candidate: null, discovery: null, deadline: null, refresh: null }
    session = room
    const current = () => session === room
    const fail = (message) => {
      if (!current()) return
      clearTimeout(room.deadline)
      clearInterval(room.refresh)
      room.game?.close()
      room.game = null
      publish('error', message)
      for (const socket of room.sockets) socket.destroy()
      room.discovery?.stop().catch(() => {})
    }
    publish(role === 'host' ? 'waiting' : 'joining', role === 'host' ? 'Waiting for a guest' : 'Looking for host')
    room.deadline = setTimeout(() => {
      if (current() && state.status !== 'connected') fail(role === 'guest' ? 'Join timed out. Leave and try again.' : 'Room announcement timed out. Leave and try again.')
    }, joinTimeout)

    const onConnection = (socket) => {
      if (!current() || state.status === 'error' || state.status === 'departed') { socket.destroy(); return }
      room.sockets.add(socket)
      let input = ''
      let stage = 'hello'
      let challenge = role === 'host' ? nonce() : null
      const hostKey = hex(role === 'host' ? socket.publicKey : socket.remotePublicKey)
      const guestKey = hex(role === 'guest' ? socket.publicKey : socket.remotePublicKey)
      let timer
      const send = (message) => socket.write(JSON.stringify(message) + '\n')
      const reject = (reason) => { send({ type: 'reject', reason }); socket.end() }
      socket.on('error', () => {}) // Discovery logs only the event class in room mode.
      socket.once('close', () => {
        clearTimeout(timer)
        room.sockets.delete(socket)
        if (!current() || room.candidate !== socket) return
        room.candidate = null
        room.game?.close()
        room.game = null
        if (state.status === 'error') return
        if (room.role === 'host') publish('waiting', 'Guest left; waiting for a guest')
        else {
          publish(state.status === 'connected' ? 'departed' : 'error',
            state.status === 'connected' ? 'Host left or connection lost. Leave to join another room.' : 'Room handshake failed. Leave and try again.')
          clearTimeout(room.deadline)
          clearInterval(room.refresh)
          room.discovery?.stop().catch(() => {})
        }
      })
      // A second/duplicate connection never changes the established room state.
      if (room.candidate) { timer = setTimeout(() => socket.destroy(), 1000); reject('full'); return }
      room.candidate = socket
      timer = setTimeout(() => socket.destroy(), handshakeTimeout)
      socket.on('data', (chunk) => {
        if (!current() || room.candidate !== socket) return
        input += chunk.toString()
        let end
        while ((end = input.indexOf('\n')) !== -1) {
          if (end > 1024) { socket.destroy(); return }
          const line = input.slice(0, end)
          input = input.slice(end + 1)
          let message
          try { message = JSON.parse(line) } catch { socket.destroy(); return }
          if (!message || typeof message !== 'object') { socket.destroy(); return }
          if (stage === 'connected' && ['game-move', 'game-state'].includes(message.type)) {
            try { room.game.receive(message) } catch { socket.destroy(); return }
          } else if (role === 'host' && stage === 'hello' && message.type === 'join' && message.version === 1 && verifyProof(message.proof, secret, 'guest', challenge, hostKey, guestKey)) {
            stage = 'ack'
            send({ type: 'accepted', role: 'host', version: 1, proof: proof(secret, 'host', challenge, hostKey, guestKey) })
          } else if (role === 'guest' && stage === 'hello' && message.type === 'challenge' && message.version === 1 && isHex32(message.challenge)) {
            challenge = message.challenge
            stage = 'proof'
            send({ type: 'join', version: 1, proof: proof(secret, 'guest', challenge, hostKey, guestKey) })
          } else if (role === 'guest' && stage === 'proof' && message.type === 'accepted' && message.role === 'host' && message.version === 1 && verifyProof(message.proof, secret, 'host', challenge, hostKey, guestKey)) {
            stage = 'ready'
            send({ type: 'ack', role: 'guest', version: 1 })
          } else if (role === 'host' && stage === 'ack' && message.type === 'ack' && message.role === 'guest' && message.version === 1) {
            stage = 'connected'
            clearTimeout(timer)
            clearTimeout(room.deadline)
            clearInterval(room.refresh)
            publish('connected', 'Guest connected')
            const matchId = nonce()
            room.game = createGameSync({ role, matchId, send })
            send({ type: 'ready', role: 'host', version: 1, matchId })
            room.game.announce()
          } else if (role === 'guest' && stage === 'ready' && message.type === 'ready' && message.role === 'host' && message.version === 1 && isHex32(message.matchId)) {
            stage = 'connected'
            clearTimeout(timer)
            clearTimeout(room.deadline)
            clearInterval(room.refresh)
            room.game = createGameSync({ role, matchId: message.matchId, send })
            publish('connected', 'Host connected')
          } else if (role === 'guest' && message.type === 'reject') {
            fail(message.reason === 'full' ? 'Room is full. Leave to try another room.' : 'Room rejected the invitation.')
            return
          } else {
            reject('invalid')
            return
          }
        }
        if (input.length > 1024) socket.destroy()
      })
      if (role === 'host') send({ type: 'challenge', version: 1, challenge })
      socket.resume()
    }

    room.discovery = startDiscovery({
      topic,
      createSwarm,
      onConnection,
      modes: { client: role === 'guest', server: role === 'host' },
      log(event) {
        // Never forward topics, public keys, raw errors, or handshake payloads.
        log({ event: ['connected', 'disconnected'].includes(event.event) ? `transport-${event.event}` : event.event, where: event.where })
        if (event.event === 'announced' && role === 'host') clearTimeout(room.deadline)
        if (event.event === 'error' && ['startup', 'announce', 'swarm', 'dht'].includes(event.where)) {
          fail('Room network unavailable. Leave and try again.')
        }
      }
    })
    if (role === 'guest' && state.status === 'joining') {
      room.refresh = setInterval(() => {
        if (current() && state.status === 'joining') {
          Promise.resolve().then(() => room.discovery.refresh()).catch(() => fail('Room lookup failed. Leave and try again.'))
        }
      }, refreshInterval)
    }
    if (state.status === 'error') room.discovery.stop().catch(() => {})
    return getState()
  }

  return { start, leave, getState,
    gameState: () => session?.game?.getState() || null,
    move: request => {
      if (state.status !== 'connected' || !session?.game) return Promise.reject(new Error('No connected match'))
      return session.game.requestMove(request)
    }
  }
}
