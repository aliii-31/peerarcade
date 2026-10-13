// Opt-in live public-DHT test, separate from deterministic npm test.
const { spawn } = require('node:child_process')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')
const peers = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function peer(name) {
  const child = spawn(electron, [path.join(__dirname, 'room-peer.cjs')], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  peers.push(child)
  child.stdout.on('data', chunk => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[${name}] ${chunk}`))
  let next = 0
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
    child.on('message', message => { if (message.ready) { clearTimeout(timer); resolve() } })
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
  return { call, quit }
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
    if (index === 1) {
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
  await host.call('leave')
  await waitState(guest, 'departed')
  await guest.call('leave')
  await Promise.all([host.quit(), guest.quit()])
  console.log('PASS: guest departure, rejoin, host departure, and clean exits')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => {
  for (const child of peers) if (child.exitCode === null) child.kill('SIGTERM')
})
