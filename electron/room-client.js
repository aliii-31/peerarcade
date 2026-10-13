const readline = require('node:readline')
const { createInvitation, parseInvitation } = require('./invitations')

function createRoomClient(worker, timeoutMs = 8000) {
  let id = 0
  let closed = false
  let busy = false
  let invitation = null
  const pending = new Map()
  const lines = readline.createInterface({ input: worker })
  function disconnect() {
    closed = true
    invitation = null
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker unavailable')) }
    pending.clear()
    lines.close()
  }
  lines.on('error', disconnect)
  worker.on('error', disconnect)
  worker.on('end', disconnect)
  worker.on('close', disconnect)
  lines.on('line', line => {
    if (!line.startsWith('{')) return
    let message
    try { message = JSON.parse(line) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.result)
  })
  function request(op, config) {
    if (closed) return Promise.reject(new Error('Worker unavailable'))
    if (pending.size >= 8) return Promise.reject(new Error('Too many pending requests'))
    const requestId = ++id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Room request timed out. Check worker health and restart if needed.'))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      try { worker.write(JSON.stringify({ id: requestId, op, config }) + '\n') }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error) }
    })
  }
  const decorate = state => {
    if (state.status === 'idle') invitation = null
    return { ...state, invitation }
  }
  async function change(action) {
    if (busy) throw new Error('A room operation is already in progress')
    busy = true
    try { return await action() } finally { busy = false }
  }
  return {
    create: () => change(async () => {
      const value = createInvitation()
      const state = await request('start', { role: 'host', ...parseInvitation(value) })
      invitation = value
      return decorate(state)
    }),
    join: value => change(async () => {
      const config = parseInvitation(value)
      const state = await request('start', { role: 'guest', ...config })
      invitation = null
      return decorate(state)
    }),
    leave: () => change(async () => {
      const state = await request('leave')
      invitation = null
      return decorate(state)
    }),
    state: async () => decorate(await request('state')),
    gameState: () => request('game-state'),
    move: value => request('move', value),
    invitation: () => invitation
  }
}
module.exports = { createRoomClient }
