// Opt-in live public-DHT test, separate from deterministic npm test.
const { spawn } = require('node:child_process')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')
const peers = []
let sensitiveLog = false
function record(chunk, output) {
  if (/pa1-[a-f0-9]{64}|[a-f0-9]{64}/.test(String(chunk))) sensitiveLog = true
  output.write(String(chunk).replace(/pa1-[a-f0-9]{64}|[a-f0-9]{64}/g, '[redacted]'))
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function peer(name) {
  const child = spawn(electron, [path.join(__dirname, 'room-peer.cjs')], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  peers.push(child)
  let disconnects = 0, logs = ''
  child.stdout.on('data', chunk => {
    logs += chunk.toString()
    let end
    while ((end = logs.indexOf('\n')) !== -1) {
      const line = logs.slice(0,end); logs = logs.slice(end+1)
      if (line.includes('\"status\":\"disconnected\"')) disconnects++
      record(`[${name}] ${line}\n`, process.stdout)
    }
  })
  child.stderr.on('data', chunk => record(`[${name}] ${chunk}`, process.stderr))
  let next = 0, workerPid
  const pending = new Map()
  child.on('message', message => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} startup timed out`)), 15000)
    child.on('message', message => { if (message.ready) { workerPid = message.workerPid; clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const call = (op, value) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${name} ${op} timed out`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    child.send({ id, op, value })
  })
  const quit = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} failed to quit`)), 8000)
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${name} exit ${code}`)) })
    child.send({ op: 'quit' })
  })
  const crash = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not terminate`)), 5000)
    child.once('exit', (_code, signal) => {
      clearTimeout(timer)
      signal === 'SIGKILL' ? resolve() : reject(new Error(`${name} unexpected termination result`))
    })
    child.kill('SIGKILL')
  })
  const workerStopped = async () => {
    const until = Date.now() + 7000
    while (Date.now() < until) {
      try { process.kill(workerPid, 0) } catch (error) { if (error.code === 'ESRCH') return; throw error }
      await delay(50)
    }
    throw new Error(`${name} left an orphan Bare worker`)
  }
  return { call, quit, crash, workerStopped, disconnections: () => disconnects }
}
async function waitState(peer, status) {
  const until = Date.now() + 60000
  while (Date.now() < until) {
    const state = await peer.call('state')
    if (state.status === status) return state
    if (state.status === 'error' && status !== 'error') throw new Error(state.message)
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${status}`)
}
async function waitRestored(peer) {
  const until = Date.now() + 65000
  while (Date.now() < until) {
    const state = await peer.call('state')
    if (state.status === 'connected' && state.message === 'Game restored') return
    if (['failed', 'error'].includes(state.status)) throw new Error(state.message)
    await delay(100)
  }
  throw new Error('Timed out waiting for authoritative recovery')
}
async function sameGame(host, guest) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    const h = await host.call('gameState'), g = await guest.call('gameState')
    if (h && g && JSON.stringify(h) === JSON.stringify(g)) return h
    await delay(50)
  }
  throw new Error('Peers did not converge on accepted game state')
}
let moveId = 0
async function play(host, guest, positions, status, winner) {
  let state = await sameGame(host, guest)
  let guestRequest
  assert.equal(state.revision, 0)
  assert.deepEqual(state.board, Array(9).fill(null))
  const request = position => ({ matchId: state.matchId, revision: state.revision, requestId: ++moveId, position })
  await assert.rejects(guest.call('move', request(0)), /turn/)
  for (const [index, position] of positions.entries()) {
    const peer = index % 2 ? guest : host
    const proposal = request(position)
    await peer.call('move', proposal)
    state = await sameGame(host, guest)
    assert.equal(state.revision, index + 1)
    assert.equal(state.board[position], index % 2 ? 'O' : 'X')
    if (index === 2 && status === 'won') {
      for (let cycle = 1; cycle <= 3; cycle++) {
      const before = state
      const detected = [host.disconnections(), guest.disconnections()]
      assert.equal(await guest.call('interrupt'), 1)
      const detectionDeadline = Date.now() + 5000
      while (host.disconnections() === detected[0] || guest.disconnections() === detected[1]) {
        if (Date.now() > detectionDeadline) throw new Error('Both peers must observe interruption')
        await delay(20)
      }
      await Promise.all([waitRestored(host), waitRestored(guest)])
      state = await sameGame(host, guest)
      assert.deepEqual(state, before)
      if (cycle === 1) await guest.call('move', guestRequest)
      else await assert.rejects(guest.call('move', guestRequest), /Invalid or stale/)
      await assert.rejects(guest.call('move', { ...request(8), revision: 0 }), /Stale revision/)
      assert.deepEqual(await sameGame(host, guest), before)
      assert.equal((await guest.call('health')).reply, 'pong')
      let acceptedHistory
      for (const participant of [host, guest]) {
        const stats = await participant.call('stats')
        assert.equal(stats.sockets, 1); assert.equal(stats.timers, 0)
        if (acceptedHistory) assert.deepEqual(stats.history, acceptedHistory)
        acceptedHistory = stats.history
        assert.equal(stats.history.length, before.revision)
      }
      console.log(`PASS: recovery cycle ${cycle}: one live socket and zero room/game timers per peer`)
      }
      console.log('PASS: real socket interrupted with both Electron/Bare processes alive; same match, revision, board and turn restored')
    }
    if (index === 1) {
      guestRequest = proposal
      await guest.call('move', proposal)
      assert.deepEqual(await sameGame(host, guest), state)
      await assert.rejects(host.call('move', request(positions[0])), /occupied/)
      await assert.rejects(host.call('move', { ...request(8), revision: 0 }), /Stale revision/)
    }
  }
  assert.equal(state.status, status)
  assert.equal(state.winner, winner)
  await assert.rejects(guest.call('move', request(8)), /complete/)
  assert.deepEqual(await sameGame(host, guest), state)
  console.log(`PASS: real synchronized ${status}, winner ${winner}, revision ${state.revision}; rejected and duplicate moves leave state unchanged`)
  return state
}
async function resilience(host, guest) {
  // Repeated room lifecycles, including both uncertain-move outcomes.
  for (const accepted of [true, false]) {
    await guest.call('leave'); await waitState(host, 'waiting')
    const invitation = (await host.call('state')).invitation
    await guest.call('join', invitation)
    await Promise.all([waitState(host, 'connected'), waitState(guest, 'connected')])
    let state = await sameGame(host, guest)
    await host.call('move', { matchId:state.matchId, requestId:++moveId, revision:0, position:0 })
    state = await sameGame(host, guest)
    await (accepted ? host : guest).call(accepted ? 'drop-state' : 'drop-move')
    const request = { matchId:state.matchId, requestId:++moveId, revision:1, position:1 }
    const pending = guest.call('move', request).then(() => 'resolved', error => error.message)
    if (accepted) {
      const until = Date.now() + 3000
      while ((await host.call('gameState')).revision !== 2) {
        if (Date.now() > until) throw new Error('Host did not accept uncertain move')
        await delay(20)
      }
    } else await delay(100)
    await guest.call('interrupt')
    assert.match(await pending, /disconnected/)
    await Promise.all([waitRestored(host), waitRestored(guest)])
    const restored = await sameGame(host, guest)
    assert.equal(restored.matchId,state.matchId)
    assert.equal(restored.revision,accepted ? 2 : 1)
    assert.equal(restored.board[1],accepted ? 'O' : null)
    await guest.call('move',request)
    assert.equal((await sameGame(host,guest)).revision,2)
    console.log(`PASS: uncertain move ${accepted ? 'accepted with lost reply' : 'never sent'} reconciled without duplicate acceptance`)
  }
  await guest.call('block')
  await waitState(guest,'disconnected')
  await guest.call('leave')
  assert.equal((await guest.call('stats')).timers,0)
  assert.equal((await guest.call('state')).status,'idle')
  await host.call('leave');await guest.call('unblock')
  const cancelled = await host.call('create');await guest.call('join',cancelled.invitation)
  await Promise.all([waitState(host,'connected'),waitState(guest,'connected')])
  console.log('PASS: Leave during recovery cancels timers; both peers can create/join again')
  await guest.call('block')
  await waitState(host,'disconnected')
  assert.ok((await host.call('stats')).timers > 0, 'Recovery deadline must be counted')
  const intruder = await peer('reserved-intruder')
  await intruder.call('join',(await host.call('state')).invitation)
  await waitState(intruder,'error');await intruder.call('leave');await intruder.quit();await intruder.workerStopped()
  await waitState(guest,'failed')
  assert.equal(await guest.call('gameState'),null)
  await assert.rejects(guest.call('move',{matchId:'ab'.repeat(32),requestId:++moveId,revision:0,position:0}),/No connected/)
  const failed = await guest.call('stats')
  assert.equal(failed.sockets,0);assert.equal(failed.timers,0)
  await guest.call('leave');await host.call('leave');await guest.call('unblock')
  const fresh = await host.call('create');await guest.call('join',fresh.invitation)
  await Promise.all([waitState(host,'connected'),waitState(guest,'connected')])
  assert.equal((await sameGame(host,guest)).revision,0)
  console.log('PASS: reserved slot rejects intruder; retries expire with no room/game timers or sockets; fresh room succeeds')
}
async function run() {
  const host = await peer('host'), guest = await peer('guest')
  await assert.rejects(guest.call('join', 'invalid'), /Invalid invitation/)
  const created = await host.call('create')
  assert.equal(created.role, 'host')
  await guest.call('join', created.invitation)
  const [h, g] = await Promise.all([waitState(host, 'connected'), waitState(guest, 'connected')])
  assert.equal(h.role, 'host'); assert.equal(g.role, 'guest')
  assert.equal((await host.call('health')).reply, 'pong')
  assert.equal((await guest.call('health')).reply, 'pong')
  console.log('PASS: host/guest roles and health across two real Electron/Bare processes')
  const oldMatch = await play(host, guest, [0,3,1,4,2], 'won', 'X')
  const extra = await peer('extra')
  await extra.call('join', created.invitation)
  assert.match((await waitState(extra, 'error')).message, /full/)
  assert.equal((await host.call('state')).status, 'connected')
  assert.equal((await guest.call('state')).status, 'connected')
  await extra.call('leave'); await extra.quit()
  console.log('PASS: third participant rejected without disturbing the pair')
  await guest.call('leave')
  await waitState(host, 'waiting')
  assert.equal((await guest.call('state')).status, 'idle')
  assert.equal(await guest.call('gameState'), null)
  assert.equal(await host.call('gameState'), null)
  await assert.rejects(guest.call('move', { matchId: oldMatch.matchId, revision: 5, requestId: ++moveId, position: 8 }), /No connected/)
  await guest.call('join', created.invitation)
  await Promise.all([waitState(host, 'connected'), waitState(guest, 'connected')])
  const fresh = await sameGame(host, guest)
  assert.notEqual(fresh.matchId, oldMatch.matchId)
  assert.equal(fresh.revision, 0)
  await assert.rejects(host.call('move', { matchId: oldMatch.matchId, revision: 0, requestId: ++moveId, position: 0 }), /Stale match/)
  await play(host, guest, [0,1,2,4,3,5,7,6,8], 'draw', null)
  await resilience(host, guest)
  await host.call('leave')
  await waitState(guest, 'departed')
  await guest.call('leave')
  // Reconnect, then terminate the guest Electron process without Leave/Quit.
  await guest.quit()
  const crashGuest = await peer('crash-guest')
  const nextRoom = await host.call('create')
  await crashGuest.call('join', nextRoom.invitation)
  await Promise.all([waitState(host, 'connected'), waitState(crashGuest, 'connected')])
  await crashGuest.crash()
  // Electron death closes Bare IPC; the surviving sidecar sends explicit Leave.
  await waitState(host, 'waiting')
  assert.equal(await host.call('gameState'), null)
  assert.equal((await host.call('health')).reply, 'pong')
  await assert.rejects(host.call('move', { matchId: oldMatch.matchId, revision: 0, requestId: ++moveId, position: 0 }), /No connected/)
  await host.call('leave')
  await host.quit()
  await Promise.all([host.workerStopped(), guest.workerStopped(), crashGuest.workerStopped(), extra.workerStopped()])
  assert.equal(sensitiveLog, false, 'Routine logs must not contain credentials, invitations or proofs')
  console.log('PASS: all tracked Bare workers exited; no secret-shaped routine log values')
  console.log('PASS: unexpected guest SIGKILL clears host match, disables moves, preserves host health and clean host shutdown')
  console.log('PASS: guest departure, rejoin, host departure, and clean exits')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => {
  for (const child of peers) if (child.exitCode === null) child.kill('SIGTERM')
})
