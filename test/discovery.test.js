const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

async function setup(failure) {
  const { startDiscovery } = await import('../p2p/discovery.mjs')
  const events = []
  const swarm = new EventEmitter()
  swarm.dht = new EventEmitter()
  swarm.join = (key, options) => {
    assert.equal(key.length, 32)
    assert.deepEqual(options, { client: true, server: true })
    return { flushed: () => failure ? Promise.reject(new Error('offline')) : Promise.resolve() }
  }
  let destroyed = 0
  swarm.destroy = async () => { destroyed++ }
  const discovery = startDiscovery({ topic: 'ab'.repeat(32), createSwarm: () => swarm, log: (e) => events.push(e) })
  return { discovery, swarm, events, destroyed: () => destroyed }
}

test('discovery announces, tracks connections and disconnects, and stops once', async () => {
  const s = await setup()
  await new Promise(setImmediate)
  const socket = new EventEmitter()
  socket.remotePublicKey = Uint8Array.from([1, 2])
  socket.resume = () => {}
  s.swarm.emit('connection', socket)
  socket.emit('close')
  await Promise.all([s.discovery.stop(), s.discovery.stop()])
  assert.deepEqual(s.events.map(e => e.event), ['discovering', 'announced', 'connected', 'disconnected', 'stopped'])
  assert.equal(s.events[2].count, 1)
  assert.equal(s.events[3].count, 0)
  assert.equal(s.destroyed(), 1)
})

test('announce, swarm, DHT, connection-attempt and socket failures are logged without throwing', async () => {
  const s = await setup(true)
  await new Promise(setImmediate)
  s.swarm.emit('error', new Error('swarm failed'))
  s.swarm.dht.emit('error', new Error('dht failed'))
  s.swarm.emit('ban', {}, new Error('dial failed'))
  const socket = new EventEmitter()
  socket.remotePublicKey = Uint8Array.from([3])
  socket.resume = () => {}
  s.swarm.emit('connection', socket)
  socket.emit('error', new Error('socket failed'))
  assert.deepEqual(s.events.filter(e => e.event === 'error').map(e => e.where), ['announce', 'swarm', 'dht', 'connection-attempt', 'socket'])
  await s.discovery.stop()
})

test('invalid configuration and constructor failure are contained', async () => {
  const { startDiscovery } = await import('../p2p/discovery.mjs')
  for (const topic of ['invalid', 'ab'.repeat(32)]) {
    const events = []
    const d = startDiscovery({ topic, createSwarm() { throw new Error('startup failed') }, log: e => events.push(e) })
    assert.equal(events[0].event, 'error')
    await d.stop()
  }
})

test('shutdown failures are reported and the same rejected stop promise is reused', async () => {
  const s = await setup()
  s.swarm.destroy = async () => { throw new Error('cannot close') }
  const stopped = s.discovery.stop()
  assert.equal(s.discovery.stop(), stopped)
  await assert.rejects(stopped, /cannot close/)
  assert.ok(s.events.some(e => e.where === 'shutdown'))
})

test('a late announcement after stop is not reported as active', async () => {
  const { startDiscovery } = await import('../p2p/discovery.mjs')
  const events = []
  let announce
  const swarm = new EventEmitter()
  swarm.dht = new EventEmitter()
  swarm.join = () => ({ flushed: () => new Promise(resolve => { announce = resolve }) })
  swarm.destroy = async () => {}
  const d = startDiscovery({ topic: 'ab'.repeat(32), createSwarm: () => swarm, log: e => events.push(e) })
  await d.stop()
  announce()
  await new Promise(setImmediate)
  assert.deepEqual(events.map(e => e.event), ['discovering', 'stopped'])
})
