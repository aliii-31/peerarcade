// Integration-test Electron process. Uses production main-side clients and a real Bare worker.
const { app } = require('electron')
const path = require('node:path')
const PearRuntime = require('pear-runtime')
const { createRoomClient } = require('../electron/room-client')
const { createWorkerClient } = require('../electron/worker-client')
let worker
let workerExitCode = null
app.whenReady().then(() => {
  worker = PearRuntime.run(path.join(__dirname, 'recovery-worker.mjs'))
  worker.on('exit', code => { workerExitCode = code; console.log('[QA] Bare exit code:', code) })
  const rooms = createRoomClient(worker)
  const health = createWorkerClient(worker)
  worker.stdout.on('data', chunk => process.stdout.write(chunk))
  worker.stderr.on('data', chunk => process.stderr.write(chunk))
  process.on('message', async ({ id, op, value }) => {
    try {
      if (op === 'interrupt') {
        const result = await new Promise((resolve, reject) => {
          let input = ''
          const timer = setTimeout(() => { worker.removeListener('data', onData); reject(new Error('Interrupt timed out')) }, 3000)
          function onData(chunk) {
            input += chunk.toString()
            let end
            while ((end = input.indexOf('\n')) !== -1) {
              const line = input.slice(0, end); input = input.slice(end + 1)
              if (!line.startsWith('qa-interrupted:')) continue
              clearTimeout(timer); worker.removeListener('data', onData); resolve(Number(line.split(':')[1])); return
            }
          }
          worker.on('data', onData)
          worker.write('qa-interrupt\n')
        })
        process.send({ id, result }); return
      }
      if (op === 'quit') {
        const timeout = setTimeout(() => { worker.destroy(); app.exit(1) }, 6000)
        worker.once('close', () => { clearTimeout(timeout); app.exit(workerExitCode === 0 ? 0 : 1) })
        worker.write('shutdown\n')
        return
      }
      const result = op === 'health' ? await health.ping() : await rooms[op](value)
      process.send({ id, result }) // Invitations stay on the test control IPC, never stdout.
    } catch (error) { process.send({ id, error: error.message }) }
  })
  process.send({ ready: true })
})
process.on('disconnect', () => { worker?.destroy(); app.exit(1) })
