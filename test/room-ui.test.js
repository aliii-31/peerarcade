const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const tick = () => new Promise(setImmediate)

test('room controls display role, copy invitation, leave, and report invalid joins', async () => {
  const elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', events: {}, addEventListener(name, callback) { this.events[name] = callback } })
    return elements.get(id)
  }
  let copied = false
  const idle = { status: 'idle', role: null, invitation: null, message: 'Not in a room' }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer/rooms.js'), 'utf8'), {
    document: { getElementById: element },
    window: { addEventListener() {}, peerArcade: {
      roomState: async () => idle,
      createRoom: async () => ({ status: 'waiting', role: 'host', invitation: 'test invitation', message: 'Waiting' }),
      copyInvitation: async () => { copied = true },
      leaveRoom: async () => idle,
      joinRoom: async () => { throw new Error('Invalid invitation') }
    } },
    setInterval() {}, clearInterval() {}
  })
  await tick()
  await element('create-room').events.click()
  assert.match(element('room-status').textContent, /host — waiting/)
  assert.equal(element('invitation').value, 'test invitation')
  assert.equal(element('join-room').disabled, true)
  await element('copy-invitation').events.click()
  assert.equal(copied, true)
  await element('leave-room').events.click()
  assert.equal(element('invitation').value, '')
  assert.equal(element('create-room').disabled, false)
  element('join-invitation').value = 'bad'
  element('join-form').events.submit({ preventDefault() {} })
  await tick()
  assert.match(element('room-error').textContent, /Invalid invitation/)
})
