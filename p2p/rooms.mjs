import { createGameSync } from './game-sync.mjs'
import { startDiscovery } from './discovery.mjs'
import { hex, nonce, proof, verifyProof, isHex32 } from './room-proof.mjs'

// Protocol v2. Credentials and retained game state never leave the Bare worker.
export function createRooms({ createSwarm, log = () => {}, joinTimeout = 45000,
  handshakeTimeout = 10000, refreshInterval = 5000, recoveryWindow = 60000,
  retryInterval = 5000, maxRetries = 6 }) {
  let state = { status: 'idle', role: null, message: 'Not in a room' }
  let session = null
  const getState = () => ({ ...state })
  const publish = (status, message) => {
    state = { status, role: session?.role || null, message }
    log({ event: 'room-state', status, role: state.role })
  }
  function timers(room) {
    clearTimeout(room.deadline); clearInterval(room.refresh)
    clearTimeout(room.recovery); clearTimeout(room.retry)
    room.recovery = room.retry = null
  }
  async function leave() {
    const old = session
    session = null
    if (old) {
      timers(old)
      old.game?.close()
      // A best-effort explicit departure; packet loss still expires at the remote deadline.
      if (old.candidate && old.send && old.admitted) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 250)
          old.candidate.once('close', () => { clearTimeout(timer); resolve() })
          try { old.send({ type: 'leave' }); old.candidate.end() } catch { clearTimeout(timer); resolve() }
        })
      }
      for (const socket of old.sockets) socket.destroy()
      await old.discovery?.stop()
      old.token = null
    }
    publish('idle', 'Not in a room')
    return getState()
  }
  async function start({ role, secret, topic }) {
    if (!['host', 'guest'].includes(role) || !isHex32(secret) || !isHex32(topic)) throw new Error('Invalid room configuration')
    if (session) throw new Error('Leave the current room first')
    const room = { role, secret, token: null, sockets: new Set(),
      candidate: null, discovery: null, game: null, generation: 0, attempts: 0, admitted: false }
    session = room
    const current = () => session === room
    const discard = () => { room.game?.close(); room.game = null; room.admitted = false; room.token = null }
    const fail = (message, status = room.recovery ? 'failed' : 'error') => {
      if (!current()) return
      timers(room); discard()
      publish(status, message)
      room.generation++
      for (const socket of room.sockets) socket.destroy()
      room.discovery?.stop().catch(() => {})
    }
    const recovered = () => {
      const wasRecovery = !!room.recovery
      timers(room); room.attempts = 0; room.admitted = true
      publish('connected', wasRecovery ? 'Game restored' : (role === 'host' ? 'Guest connected' : 'Host connected'))
    }
    const retry = () => {
      if (!current() || !room.recovery || room.retry || role !== 'guest') return
      room.retry = setTimeout(async () => {
        room.retry = null
        if (!current() || !room.recovery) return
        if (room.attempts >= maxRetries) { fail('Unable to reconnect. Leave and create or join a fresh room.', 'failed'); return }
        room.attempts++
        publish('reconnecting', `Reconnecting (${room.attempts}/${maxRetries})`)
        // A fresh client swarm avoids inheriting unbounded internal retry backoff.
        room.generation++
        room.candidate = null
        try { await room.discovery?.stop() } catch {}
        if (!current() || !room.recovery) return
        launch()
        retry()
      }, retryInterval)
    }
    const disconnected = () => {
      room.game?.suspend()
      if (!room.recovery) {
        clearTimeout(room.deadline); clearInterval(room.refresh)
        publish('disconnected', 'Connection lost. Waiting to restore the game.')
        room.recovery = setTimeout(() => fail('Unable to reconnect. Recovery window expired. Leave to start a fresh room.', 'failed'), recoveryWindow)
      }
      retry()
    }
    const onConnection = (socket, generation) => {
      if (!current() || generation !== room.generation || ['error', 'failed', 'departed'].includes(state.status)) { socket.destroy(); return }
      room.sockets.add(socket)
      let input = '', stage = 'hello', deliberate = false
      let challenge = role === 'host' ? nonce() : null
      let resumeId = role === 'host' ? room.game?.getState().matchId : null
      const hostKey = hex(role === 'host' ? socket.publicKey : socket.remotePublicKey)
      const guestKey = hex(role === 'guest' ? socket.publicKey : socket.remotePublicKey)
      let timer
      const valid = () => current() && generation === room.generation && room.candidate === socket
      const send = message => socket.write(JSON.stringify(message) + '\n')
      const reject = reason => { send({ type: 'reject', reason }); socket.end() }
      socket.on('error', () => {})
      socket.once('close', () => {
        clearTimeout(timer); room.sockets.delete(socket)
        if (!valid()) return
        room.candidate = null; room.send = null
        if (['error', 'failed', 'departed'].includes(state.status)) return
        if (!deliberate && (room.game || room.admitted)) { disconnected(); return }
        discard()
        if (role === 'host') publish('waiting', 'Guest left; waiting for a guest')
        else {
          timers(room)
          publish(deliberate ? 'departed' : 'error', deliberate ? 'Host left. Leave to join another room.' : 'Room handshake failed. Leave and try again.')
          room.discovery?.stop().catch(() => {})
        }
      })
      if (room.candidate) { timer = setTimeout(() => socket.destroy(), 1000); reject('full'); return }
      room.candidate = socket; room.send = send
      timer = setTimeout(() => socket.destroy(), handshakeTimeout)
      socket.on('data', chunk => {
        if (!valid()) return
        input += chunk.toString()
        let end
        while ((end = input.indexOf('\n')) !== -1) {
          if (!valid()) return
          if (end > 1024) { socket.destroy(); return }
          const line = input.slice(0, end); input = input.slice(end + 1)
          let m
          try { m = JSON.parse(line) } catch { socket.destroy(); return }
          if (!m || typeof m !== 'object') { socket.destroy(); return }
          if (stage === 'connected' && m.type === 'leave') {
            deliberate = true; timers(room); discard(); socket.end(); return
          }
          if (stage === 'connected' && ['game-move', 'game-state'].includes(m.type)) {
            try { room.game.receive(m) } catch {
              deliberate = true; discard(); send({ type: 'leave' }); socket.end()
            }
          } else if (role === 'host' && stage === 'hello' && m.type === 'join' && m.version === 2 && verifyProof(m.proof, secret, 'guest', challenge, hostKey, guestKey)) {
            if (resumeId) {
              if (m.matchId !== resumeId || !verifyProof(m.resumeProof, room.token, `resume-guest:${resumeId}`, challenge, hostKey, guestKey)) { reject('reserved'); return }
            } else {
              if (m.matchId) { reject('expired'); return }
              room.token = nonce()
              room.game = createGameSync({ role, matchId: nonce(), send })
              room.game.suspend()
            }
            stage = 'ack'
            send({ type: 'accepted', version: 2, token: resumeId ? null : room.token, proof: proof(secret, 'host', challenge, hostKey, guestKey),
              resumeProof: resumeId ? proof(room.token, `resume-host:${resumeId}`, challenge, hostKey, guestKey) : null })
          } else if (role === 'guest' && stage === 'hello' && m.type === 'challenge' && m.version === 2 && isHex32(m.challenge)) {
            challenge = m.challenge; resumeId = m.matchId
            if ((resumeId !== null && !isHex32(resumeId)) || (room.game && room.game.getState().matchId !== resumeId)) { fail('Unable to reconnect. The previous match is no longer available.', 'failed'); return }
            if (resumeId && !isHex32(room.token)) { fail('Room reserved for the previous guest. Leave to join another room.'); return }
            stage = 'proof'
            send({ type: 'join', version: 2, proof: proof(secret, 'guest', challenge, hostKey, guestKey),
              matchId: resumeId,
              resumeProof: resumeId ? proof(room.token, `resume-guest:${resumeId}`, challenge, hostKey, guestKey) : null })
          } else if (role === 'guest' && stage === 'proof' && m.type === 'accepted' && m.version === 2 && verifyProof(m.proof, secret, 'host', challenge, hostKey, guestKey)) {
            if (resumeId && !verifyProof(m.resumeProof, room.token, `resume-host:${resumeId}`, challenge, hostKey, guestKey)) { fail('Unable to verify the returning host.', 'failed'); return }
            if (!resumeId) {
              if (!isHex32(m.token)) { fail('Invalid room admission. Leave and try again.'); return }
              room.token = m.token
            }
            room.admitted = true; stage = 'ready'
            send({ type: 'ack', version: 2 })
          } else if (role === 'host' && stage === 'ack' && m.type === 'ack' && m.version === 2) {
            stage = 'connected'; clearTimeout(timer)
            room.game.resume(send)
            send({ type: 'ready', version: 2, state: room.game.exportState() })
            recovered()
          } else if (role === 'guest' && stage === 'ready' && m.type === 'ready' && m.version === 2 && isHex32(m.state?.matchId)) {
            if (resumeId && m.state.matchId !== resumeId) { fail('Unable to restore the previous match.', 'failed'); return }
            if (!room.game) room.game = createGameSync({ role, matchId: m.state.matchId, send })
            room.game.resume(send)
            try { room.game.receive(m.state) } catch { fail('Unable to restore the accepted game state.', 'failed'); return }
            stage = 'connected'; clearTimeout(timer); recovered()
          } else if (role === 'guest' && m.type === 'reject') {
            fail(m.reason === 'full' ? 'Room is full. Leave to try another room.' : 'Unable to reconnect or join: room reserved or invitation rejected.', room.recovery ? 'failed' : 'error'); return
          } else { reject('invalid'); return }
        }
        if (input.length > 1024) socket.destroy()
      })
      if (role === 'host') send({ type: 'challenge', version: 2, challenge, matchId: resumeId || null })
      socket.resume()
    }
    function launch() {
      const generation = room.generation
      room.discovery = startDiscovery({ topic, createSwarm, onConnection: socket => onConnection(socket, generation),
        modes: { client: role === 'guest', server: role === 'host' },
        log(event) {
          if (!current() || generation !== room.generation) return
          log({ event: ['connected', 'disconnected'].includes(event.event) ? `transport-${event.event}` : event.event, where: event.where })
          if (event.event === 'announced' && role === 'host') clearTimeout(room.deadline)
          if (event.event === 'error' && ['startup', 'announce', 'swarm', 'dht'].includes(event.where)) {
            if (room.game || room.admitted) {
              disconnected()
              for (const socket of room.sockets) socket.destroy()
            } else fail('Room network unavailable. Leave and try again.')
          }
        }
      })
    }
    publish(role === 'host' ? 'waiting' : 'joining', role === 'host' ? 'Waiting for a guest' : 'Looking for host')
    room.deadline = setTimeout(() => fail('Join timed out. Leave and try again.'), joinTimeout)
    launch()
    if (role === 'guest' && state.status === 'joining') {
      room.refresh = setInterval(() => {
        if (current() && state.status === 'joining') Promise.resolve().then(() => room.discovery.refresh()).catch(() => fail('Room lookup failed. Leave and try again.'))
      }, refreshInterval)
    }
    if (state.status === 'error') room.discovery.stop().catch(() => {})
    return getState()
  }
  return { start, leave, getState,
    gameState: () => state.status === 'connected' ? session?.game?.getState() || null : null,
    move: request => {
      if (state.status !== 'connected' || !session?.game) return Promise.reject(new Error('No connected match'))
      return session.game.requestMove(request)
    }
  }
}
