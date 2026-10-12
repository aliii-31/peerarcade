const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const PearRuntime = require('pear-runtime')

test('Pear Runtime starts Bare and loads Hyperswarm without discovery', { timeout: 15000 }, async (t) => {
  const worker = PearRuntime.run(path.join(__dirname, '..', 'p2p', 'main.mjs'))
  t.after(() => worker.destroy())
  let stderr = ''
  worker.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  const output = await new Promise((resolve, reject) => {
    let received = ''
    worker.on('error', reject)
    worker.on('close', () => reject(new Error(`Worker closed before readiness: ${stderr}`)))
    worker.on('data', (chunk) => {
      received += chunk.toString()
      if (received.includes('\n')) resolve(received.trim())
    })
  })
  assert.equal(output, 'PeerArcade worker ready (networking disabled)')
  assert.equal(stderr, '')
})
