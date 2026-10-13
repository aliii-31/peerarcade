const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('preload exposes only a fixed, payload-free health-check method', async () => {
  let api
  const calls = []
  vm.runInNewContext(source('electron/preload.js'), {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld(name, exposed) {
          assert.equal(name, 'peerArcade')
          api = exposed
        } },
        ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve('result') } }
      }
    }
  })
  assert.deepEqual(Object.keys(api), ['checkWorker', 'createRoom', 'joinRoom', 'leaveRoom', 'roomState', 'gameState', 'requestMove', 'copyInvitation'])
  assert.equal(await api.checkWorker('untrusted payload'), 'result')
  assert.deepEqual(calls, [['peerarcade:check-worker']])
})

for (const succeeds of [true, false]) {
  test(`renderer displays ${succeeds ? 'pong' : 'failure'} and allows another check`, async () => {
    let click
    const status = { textContent: '' }
    const button = { disabled: false, addEventListener(event, callback) { click = callback } }
    const context = {
      document: { getElementById(id) { return id === 'worker-status' ? status : button } },
      window: {
        peerArcade: { async checkWorker() {
          if (!succeeds) throw new Error('disconnected')
          return { status: 'ready', reply: 'pong' }
        } },
        addEventListener() {}
      },
      setInterval() { return 1 }, clearInterval() {}
    }
    vm.runInNewContext(source('renderer/app.js'), context)
    await new Promise(setImmediate)
    assert.match(status.textContent, succeeds ? /pong received/ : /unavailable/)
    assert.equal(button.disabled, false)
    await click()
    assert.equal(button.disabled, false)
  })
}

test('preload forwards game requests only on fixed game channels', async () => {
  let api
  const calls = []
  vm.runInNewContext(source('electron/preload.js'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_, value) => { api = value } },
      ipcRenderer: { invoke: (...args) => { calls.push(args) } } })
  })
  const request = { matchId: 'ab'.repeat(32), revision: 0, requestId: 1, position: 0 }
  await api.gameState('ignored')
  await api.requestMove(request, 'ignored')
  assert.deepEqual(calls, [['peerarcade:game-state'], ['peerarcade:game-move', request]])
})
