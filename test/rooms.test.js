const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createInvitation, parseInvitation } = require('../electron/invitations')
const tick = () => new Promise(setImmediate)

async function setup(role, config, options = {}) {
  const { createRooms } = await import('../p2p/rooms.mjs')
  const swarm = new EventEmitter()
  swarm.dht = new EventEmitter()
  const sockets = new Set()
  let refreshes = 0
  swarm.join = (_topic, modes) => {
    assert.deepEqual(modes, { client: role === 'guest', server: role === 'host' })
    return { flushed: () => Promise.resolve(), refresh: () => { refreshes++ } }
  }
  swarm.destroy = async () => { for (const socket of sockets) socket.destroy() }
  swarm.on('connection', socket => sockets.add(socket))
  const logs = []
  const rooms = createRooms({ createSwarm: () => swarm, log: e => logs.push(e), joinTimeout: 1000, handshakeTimeout: 100, ...options })
  await rooms.start({ role, ...config })
  await tick()
  return { rooms, swarm, logs, refreshes: () => refreshes }
}
function connect(host, guest) {
  const a = new EventEmitter(), b = new EventEmitter()
  a.publicKey = b.remotePublicKey = new Uint8Array(32).fill(1)
  b.publicKey = a.remotePublicKey = new Uint8Array(32).fill(2)
  for (const [socket, remote] of [[a, b], [b, a]]) {
    socket.closed = false
    socket.resume = () => {}
    socket.write = message => queueMicrotask(() => { if (!remote.closed) remote.emit('data', Buffer.from(message)) })
    socket.destroy = () => {
      if (socket.closed) return
      socket.closed = true
      socket.emit('close')
      remote.destroy()
    }
    socket.end = () => queueMicrotask(() => socket.destroy())
  }
  host.swarm.emit('connection', a)
  guest.swarm.emit('connection', b)
  return [a, b]
}
const config = () => parseInvitation(createInvitation())

test('invitations have 256 random bits, deterministic topic derivation, and strict validation', () => {
  const a = createInvitation(), b = createInvitation()
  assert.match(a, /^pa1-[a-f0-9]{64}$/)
  assert.notEqual(a, b)
  assert.deepEqual(parseInvitation(a), parseInvitation(a))
  assert.notEqual(parseInvitation(a).topic, parseInvitation(b).topic)
  for (const value of [null, {}, '', a + 'x', a.toUpperCase(), ' ' + a]) assert.throws(() => parseInvitation(value), /Invalid invitation/)
})

test('host and guest agree on roles; extra peers are rejected; guest departure frees the room', async (t) => {
  const c = config(), h = await setup('host', c), g = await setup('guest', c), extra = await setup('guest', c)
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave(); await extra.rooms.leave() })
  connect(h, g)
  await tick()
  assert.equal(h.rooms.getState().status, 'connected')
  assert.equal(g.rooms.getState().status, 'connected')
  assert.equal(h.rooms.getState().role, 'host')
  assert.equal(g.rooms.getState().role, 'guest')
  connect(h, extra)
  await tick()
  assert.equal(extra.rooms.getState().status, 'error')
  assert.match(extra.rooms.getState().message, /full/)
  assert.equal(h.rooms.getState().status, 'connected')
  await g.rooms.leave()
  await tick()
  assert.equal(h.rooms.getState().status, 'waiting')
  assert.equal(g.rooms.getState().status, 'idle')
  assert.ok(!JSON.stringify(h.logs).includes(c.secret))
  assert.ok(!JSON.stringify(h.logs).includes(c.topic))
})

test('host departure leaves the guest departed without host migration', async (t) => {
  const c = config(), h = await setup('host', c), g = await setup('guest', c)
  t.after(() => g.rooms.leave())
  connect(h, g)
  await tick()
  await h.rooms.leave()
  await tick()
  assert.equal(h.rooms.getState().status, 'idle')
  assert.equal(g.rooms.getState().status, 'departed')
})

test('wrong invitation proof is rejected without admitting a guest', async (t) => {
  const c = config(), h = await setup('host', c), g = await setup('guest', { ...c, secret: 'cd'.repeat(32) })
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave() })
  connect(h, g)
  await tick()
  assert.equal(h.rooms.getState().status, 'waiting')
  assert.equal(g.rooms.getState().status, 'error')
})

test('failed joins time out, and leave permits a fresh room', async () => {
  const c = config(), g = await setup('guest', c, { joinTimeout: 20 })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(g.rooms.getState().status, 'error')
  await assert.rejects(g.rooms.start({ role: 'guest', ...c }), /Leave/)
  await g.rooms.leave()
  assert.equal(g.rooms.getState().status, 'idle')
})

test('network errors are contained and cleanup is repeatable', async () => {
  const h = await setup('host', config())
  h.swarm.dht.emit('error', new Error('network unavailable'))
  assert.equal(h.rooms.getState().status, 'error')
  await h.rooms.leave()
  await h.rooms.leave()
  assert.equal(h.rooms.getState().status, 'idle')
})

test('room proofs reject changed roles, challenges, and connection keys', async () => {
  const { proof, verifyProof, nonce } = await import('../p2p/room-proof.mjs')
  const secret = config().secret, challenge = nonce(), host = '01'.repeat(32), guest = '02'.repeat(32)
  const value = proof(secret, 'guest', challenge, host, guest)
  assert.equal(verifyProof(value, secret, 'guest', challenge, host, guest), true)
  assert.equal(verifyProof(value, secret, 'host', challenge, host, guest), false)
  assert.equal(verifyProof(value, secret, 'guest', nonce(), host, guest), false)
  assert.equal(verifyProof(value, secret, 'guest', challenge, guest, host), false)
  assert.equal(verifyProof(null, secret, 'guest', challenge, host, guest), false)
})

test('guest refreshes lookups while joining and cancels refresh on leave', async () => {
  const g = await setup('guest', config(), { refreshInterval: 10 })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(g.refreshes() > 0)
  await g.rooms.leave()
  const count = g.refreshes()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(g.refreshes(), count)
  assert.equal(g.rooms.getState().status, 'idle')
})

test('duplicate transport connections leave established roles unchanged', async (t) => {
  const c = config(), h = await setup('host', c), g = await setup('guest', c)
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave() })
  connect(h, g); await tick()
  connect(h, g); await tick()
  assert.equal(h.rooms.getState().status, 'connected')
  assert.equal(g.rooms.getState().status, 'connected')
})

test('malformed and oversized handshake messages release the pending slot', async (t) => {
  const c = config(), h = await setup('host', c)
  t.after(() => h.rooms.leave())
  for (const data of ['not-json\n', 'x'.repeat(1025)]) {
    const socket = new EventEmitter()
    socket.publicKey = new Uint8Array(32).fill(1)
    socket.remotePublicKey = new Uint8Array(32).fill(2)
    socket.write = socket.resume = () => {}
    socket.destroy = () => socket.emit('close')
    h.swarm.emit('connection', socket)
    socket.emit('data', Buffer.from(data))
    assert.equal(h.rooms.getState().status, 'waiting')
  }
})

test('room game messages require admission; departure discards match and rejoin starts fresh', async t => {
  const c = config(), h = await setup('host', c)
  let g = await setup('guest', c)
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave() })
  assert.equal(h.rooms.gameState(), null)
  await assert.rejects(h.rooms.move({}), /No connected/)
  const [hostSocket] = connect(h, g); await tick()
  const initial = h.rooms.gameState()
  assert.deepEqual(initial, g.rooms.gameState())
  await h.rooms.move({ matchId: initial.matchId, requestId: 1, revision: 0, position: 0 }); await tick()
  await g.rooms.move({ matchId: initial.matchId, requestId: 1, revision: 1, position: 1 }); await tick()
  assert.deepEqual(h.rooms.gameState(), g.rooms.gameState())
  assert.equal(h.rooms.gameState().revision, 2)
  await g.rooms.leave(); await tick()
  assert.equal(h.rooms.gameState(), null)
  await assert.rejects(g.rooms.move({}), /No connected/)
  g = await setup('guest', c)
  connect(h, g); await tick()
  const fresh = h.rooms.gameState()
  assert.notEqual(fresh.matchId, initial.matchId)
  assert.equal(fresh.revision, 0)
  hostSocket.emit('data', Buffer.from(JSON.stringify({ type: 'game-move', request: { matchId: initial.matchId, requestId: 2, revision: 0, position: 8 } }) + '\n'))
  assert.deepEqual(h.rooms.gameState(), fresh)
})

test('malformed admitted game frames close safely and clear the match', async t => {
  const c = config(), h = await setup('host', c), g = await setup('guest', c)
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave() })
  const [, guestSocket] = connect(h, g); await tick()
  guestSocket.emit('data', Buffer.from(JSON.stringify({ type: 'game-state', matchId: g.rooms.gameState().matchId, moves: [99], revision: 1, requestId: null, error: null }) + '\n'))
  await tick() // Explicit protocol departure is delivered before socket cleanup.
  assert.equal(g.rooms.gameState(), null)
  assert.equal(h.rooms.gameState(), null)
  assert.equal(h.rooms.getState().status, 'waiting')
})

test('game messages before handshake cannot create or mutate a match', async t => {
  const h = await setup('host', config())
  t.after(() => h.rooms.leave())
  const socket = new EventEmitter()
  socket.publicKey = new Uint8Array(32).fill(1)
  socket.remotePublicKey = new Uint8Array(32).fill(2)
  socket.write = socket.resume = () => {}
  socket.destroy = socket.end = () => socket.emit('close')
  h.swarm.emit('connection', socket)
  socket.emit('data', Buffer.from('{"type":"game-move","request":{}}\n'))
  assert.equal(h.rooms.gameState(), null)
  assert.equal(h.rooms.getState().status, 'waiting')
})

test('unexpected transport loss restores same match and move IDs; old socket callbacks are ignored', async t => {
  const c = config(), h = await setup('host', c), g = await setup('guest', c)
  t.after(async () => { await h.rooms.leave(); await g.rooms.leave() })
  const [old] = connect(h,g); await tick()
  const id = h.rooms.gameState().matchId
  await h.rooms.move({ matchId:id, requestId:1, revision:0, position:0 }); await tick()
  const proposal = { matchId:id, requestId:1, revision:1, position:1 }
  await g.rooms.move(proposal)
  const before = h.rooms.gameState()
  old.destroy(); await tick()
  assert.equal(h.rooms.getState().status,'disconnected')
  assert.equal(g.rooms.getState().status,'disconnected')
  assert.equal(h.rooms.gameState(),null)
  await assert.rejects(g.rooms.move(proposal),/No connected/)
  connect(h,g); await tick()
  assert.deepEqual(h.rooms.gameState(),before)
  assert.deepEqual(g.rooms.gameState(),before)
  assert.equal(g.rooms.getState().message,'Game restored')
  await g.rooms.move(proposal)
  assert.deepEqual(h.rooms.gameState(),before)
  await assert.rejects(g.rooms.move({...proposal,position:2}),/Invalid or stale/)
  await assert.rejects(h.rooms.move({matchId:id,requestId:2,revision:0,position:2}),/Stale revision/)
  old.emit('data',Buffer.from(JSON.stringify({type:'game-move',request:{matchId:id,requestId:99,revision:2,position:3}})+'\n'))
  assert.deepEqual(h.rooms.gameState(),before)
  await h.rooms.move({matchId:id,requestId:3,revision:2,position:2}); await tick()
  assert.deepEqual(h.rooms.gameState(),g.rooms.gameState())
  assert.equal(g.rooms.gameState().revision,3)
})

test('invitation holder cannot claim reserved recovery slot; genuine guest can still recover', async t => {
  const c=config(),h=await setup('host',c),g=await setup('guest',c),other=await setup('guest',c)
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave();await other.rooms.leave()})
  const [socket]=connect(h,g);await tick();const before=h.rooms.gameState()
  socket.destroy();await tick();connect(h,other);await tick()
  assert.equal(other.rooms.getState().status,'error')
  assert.match(other.rooms.getState().message,/reserved/)
  assert.equal(h.rooms.getState().status,'disconnected')
  connect(h,g);await tick();assert.deepEqual(h.rooms.gameState(),before)
  assert.deepEqual(g.rooms.gameState(),before)
  assert.ok(h.logs.every(entry=>Object.keys(entry).every(key=>['event','status','role','where'].includes(key))))
})

test('repeated outages recover without resetting match; retries and recovery window expire cleanly', async t => {
  const c=config(),h=await setup('host',c,{recoveryWindow:100}),g=await setup('guest',c,{recoveryWindow:100,retryInterval:10,maxRetries:2})
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave()})
  let [socket]=connect(h,g);await tick();const id=h.rooms.gameState().matchId
  for(let i=0;i<2;i++){socket.destroy();await tick();[socket]=connect(h,g);await tick();assert.equal(h.rooms.gameState().matchId,id)}
  socket.destroy();await new Promise(resolve=>setTimeout(resolve,55))
  assert.equal(g.rooms.getState().status,'failed')
  assert.equal(g.logs.filter(e=>e.status==='reconnecting').length,2)
  await new Promise(resolve=>setTimeout(resolve,65))
  assert.equal(h.rooms.getState().status,'failed')
  assert.equal(h.rooms.gameState(),null)
  const count=g.logs.length;await new Promise(resolve=>setTimeout(resolve,25));assert.equal(g.logs.length,count)
})

test('intentional leave during recovery cancels retries; late connection cannot resurrect room', async t => {
  const c=config(),h=await setup('host',c),g=await setup('guest',c,{retryInterval:15})
  t.after(()=>h.rooms.leave())
  const [socket]=connect(h,g);await tick();socket.destroy();await tick()
  await g.rooms.leave();const count=g.logs.length
  await new Promise(resolve=>setTimeout(resolve,40))
  connect(h,g);await tick()
  assert.equal(g.rooms.getState().status,'idle')
  assert.equal(g.rooms.gameState(),null)
  assert.equal(g.logs.length,count)
})

test('unavailable host after abrupt transport loss reaches failed without creating a new match', async t => {
  const c=config(),h=await setup('host',c),g=await setup('guest',c,{recoveryWindow:30,retryInterval:10,maxRetries:6})
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave()})
  const [socket]=connect(h,g);await tick();socket.destroy();await h.rooms.leave()
  await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(g.rooms.getState().status,'failed')
  assert.equal(g.rooms.gameState(),null)
  await assert.rejects(g.rooms.move({}),/No connected/)
})

test('accepted move with lost reply is reconciled and duplicate request remains idempotent', async t => {
  const c=config(),h=await setup('host',c),g=await setup('guest',c)
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave()})
  const [a]=connect(h,g);await tick();const id=h.rooms.gameState().matchId
  await h.rooms.move({matchId:id,requestId:1,revision:0,position:0});await tick()
  a.write=()=>true // Drop host responses after it accepts O's move.
  const request={matchId:id,requestId:1,revision:1,position:1}
  const pending=g.rooms.move(request);const rejected=assert.rejects(pending,/disconnected/)
  await tick();assert.equal(h.rooms.gameState().revision,2)
  a.destroy();await rejected
  connect(h,g);await tick()
  assert.equal(g.rooms.gameState().revision,2)
  await g.rooms.move(request)
  assert.equal(h.rooms.gameState().revision,2)
})

test('expired host state cannot silently create a new match for an old guest', async t => {
  const c=config();let h=await setup('host',c,{recoveryWindow:20})
  const g=await setup('guest',c,{recoveryWindow:1000})
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave()})
  const [socket]=connect(h,g);await tick();socket.destroy()
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(h.rooms.getState().status,'failed')
  await h.rooms.leave();h=await setup('host',c)
  connect(h,g);await tick()
  assert.equal(g.rooms.getState().status,'failed')
  assert.equal(g.rooms.gameState(),null)
  assert.equal(h.rooms.gameState(),null)
})

test('intentional leave cancels an uncertain pending move promptly', async t => {
  const c=config(),h=await setup('host',c),g=await setup('guest',c)
  t.after(()=>h.rooms.leave())
  const [a]=connect(h,g);await tick();const id=h.rooms.gameState().matchId
  await h.rooms.move({matchId:id,requestId:1,revision:0,position:0});await tick()
  a.write=()=>true
  const result=assert.rejects(g.rooms.move({matchId:id,requestId:1,revision:1,position:1}),/disconnected/)
  await tick();await g.rooms.leave();await result
  assert.equal(g.rooms.getState().status,'idle')
  assert.equal(h.rooms.getState().status,'waiting')
})

test('host rejects forged resume proof even with a valid invitation proof', async t => {
  const { proof }=await import('../p2p/room-proof.mjs')
  const c=config(),h=await setup('host',c),g=await setup('guest',c)
  t.after(async()=>{await h.rooms.leave();await g.rooms.leave()})
  const [old]=connect(h,g);await tick();const before=h.rooms.gameState()
  old.destroy();await tick()
  const socket=new EventEmitter(),sent=[]
  socket.publicKey=new Uint8Array(32).fill(3);socket.remotePublicKey=new Uint8Array(32).fill(4)
  socket.write=text=>sent.push(JSON.parse(text));socket.resume=()=>{}
  socket.destroy=socket.end=()=>socket.emit('close')
  h.swarm.emit('connection',socket)
  const challenge=sent[0].challenge
  const join={type:'join',version:2,matchId:before.matchId,
    proof:proof(c.secret,'guest',challenge,'03'.repeat(32),'04'.repeat(32)),
    resumeProof:proof('ff'.repeat(32),`resume-guest:${before.matchId}`,challenge,'03'.repeat(32),'04'.repeat(32))}
  socket.emit('data',Buffer.from(JSON.stringify(join)+'\n'))
  assert.equal(sent.at(-1).reason,'reserved')
  assert.equal(h.rooms.getState().status,'disconnected')
  connect(h,g);await tick();assert.deepEqual(h.rooms.gameState(),before)
})
