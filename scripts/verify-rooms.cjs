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
  await guest.call('join', created.invitation)
  await Promise.all([waitState(host, 'connected'), waitState(guest, 'connected')])
  await host.call('leave')
  await waitState(guest, 'departed')
  await guest.call('leave')
  await Promise.all([host.quit(), guest.quit()])
  console.log('PASS: guest departure, rejoin, host departure, and clean exits')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => {
  for (const child of peers) if (child.exitCode === null) child.kill('SIGTERM')
})
