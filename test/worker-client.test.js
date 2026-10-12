const test = require('node:test')
const assert = require('node:assert/strict')
const { Duplex } = require('node:stream')
const path = require('node:path')
const PearRuntime = require('pear-runtime')
const { createWorkerClient } = require('../electron/worker-client')

function fakeWorker() {
  const sent = []
  const worker = new Duplex({ read() {}, write(chunk, encoding, callback) {
    sent.push(chunk.toString())
    callback()
  } })
  return { worker, sent }
}

test('real Bare worker completes repeated health checks', { timeout: 15000 }, async (t) => {
  const worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'))
  const client = createWorkerClient(worker)
  t.after(() => client.close())
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await client.ping(), { status: 'ready', reply: 'pong' })
  }
})

test('client handles split/coalesced lines and ignores unrelated replies', async (t) => {
  const { worker, sent } = fakeWorker()
  const client = createWorkerClient(worker)
  t.after(() => client.close())
  const first = client.ping()
  assert.equal(client.ping(), first)
  assert.deepEqual(sent, ['ping:1\n'])
  worker.push('ready\npong:999\npo')
  worker.push('ng:1\n')
  assert.equal((await first).reply, 'pong')
})

test('timeout rejects and a later check can succeed', async (t) => {
  const { worker } = fakeWorker()
  const client = createWorkerClient(worker, 30)
  t.after(() => client.close())
  await assert.rejects(client.ping(), /timed out/)
  const retry = client.ping()
  worker.push('pong:1\npong:2\n')
  assert.equal((await retry).status, 'ready')
})

for (const event of ['end', 'close', 'error']) {
  test(`worker ${event} rejects pending and future checks`, async () => {
    const { worker } = fakeWorker()
    const client = createWorkerClient(worker)
    const pending = client.ping()
    worker.emit(event, new Error('test failure'))
    await assert.rejects(pending, /disconnected/)
    await assert.rejects(client.ping(), /disconnected/)
    client.close()
  })
}
