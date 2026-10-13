const test = require('node:test')
const assert = require('node:assert/strict')
const { Duplex } = require('node:stream')
const { createRoomClient } = require('../electron/room-client')
const { createInvitation, parseInvitation } = require('../electron/invitations')

function fake(timeout = 1000) {
  const requests = []
  const worker = new Duplex({ read() {}, write(chunk, encoding, callback) { requests.push(JSON.parse(chunk.toString())); callback() } })
  const client = createRoomClient(worker, timeout)
  const reply = (result, error) => worker.push(JSON.stringify({ id: requests.at(-1).id, result, error }) + '\n')
  return { worker, requests, client, reply }
}

test('room client validates invitations before sending and rejects concurrent mutations', async (t) => {
  const f = fake(); t.after(() => f.worker.destroy())
  await assert.rejects(f.client.join('bad'), /Invalid invitation/)
  assert.equal(f.requests.length, 0)
  const creating = f.client.create()
  await assert.rejects(f.client.create(), /already in progress/)
  f.reply({ status: 'waiting', role: 'host' })
  const result = await creating
  assert.deepEqual(f.requests[0].config, { role: 'host', ...parseInvitation(result.invitation) })
  assert.equal(f.client.invitation(), result.invitation)
  const leaving = f.client.leave()
  f.reply({ status: 'idle', role: null })
  assert.equal((await leaving).invitation, null)
})

test('guest requests contain validated configuration and no displayed invitation', async (t) => {
  const f = fake(); t.after(() => f.worker.destroy())
  const value = createInvitation()
  const joining = f.client.join(value)
  f.reply({ status: 'joining', role: 'guest' })
  assert.equal((await joining).invitation, null)
  assert.deepEqual(f.requests[0].config, { role: 'guest', ...parseInvitation(value) })
})

test('worker errors and room failures reject without hanging', async (t) => {
  const f = fake(); t.after(() => f.worker.destroy())
  const creating = f.client.create()
  f.reply(null, 'Leave the current room first')
  await assert.rejects(creating, /Leave/)
  const waiting = f.client.state()
  f.worker.destroy()
  await assert.rejects(waiting, /unavailable/)
  await assert.rejects(f.client.state(), /unavailable/)
})

test('room request timeout rejects and late replies are ignored', async (t) => {
  const f = fake(20); t.after(() => f.worker.destroy())
  await assert.rejects(f.client.state(), /timed out/)
  f.reply({ status: 'idle' })
  const next = f.client.state()
  f.reply({ status: 'idle' })
  assert.equal((await next).status, 'idle')
})
