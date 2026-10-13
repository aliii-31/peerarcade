const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const PearRuntime = require('pear-runtime')
const { createWorkerClient } = require('../electron/worker-client')

test('invalid network config does not prevent Bare health checks or shutdown', { timeout: 15000 }, async (t) => {
  const worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'), ['invalid'])
  t.after(() => worker.destroy())
  let logs = ''
  worker.stdout.on('data', chunk => { logs += chunk.toString() })
  const client = createWorkerClient(worker)
  assert.equal((await client.ping()).reply, 'pong')
  const closed = new Promise(resolve => worker.once('close', resolve))
  worker.write('shutdown\n')
  await closed
  assert.match(logs, /"where":"startup"/)
  assert.match(logs, /"event":"stopped"/)
})
