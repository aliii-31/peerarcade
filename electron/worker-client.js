const readline = require('node:readline')

// One in-flight check, shared by callers; IDs prevent late replies matching retries.
function createWorkerClient(worker, timeoutMs = 3000) {
  let sequence = 0
  let pending = null
  let closed = false
  const lines = readline.createInterface({ input: worker })

  function finish(error, result) {
    if (!pending) return
    const request = pending
    pending = null
    clearTimeout(request.timer)
    if (error) request.reject(error)
    else request.resolve(result)
  }

  lines.on('line', (line) => {
    if (pending && line === `pong:${pending.id}`) {
      finish(null, { status: 'ready', reply: 'pong' })
    }
  })
  function disconnect() {
    closed = true
    finish(new Error('Worker disconnected'))
    lines.close()
  }
  lines.on('error', disconnect)
  worker.on('error', disconnect)
  worker.on('end', disconnect)
  worker.on('close', disconnect)

  function ping() {
    if (closed) return Promise.reject(new Error('Worker disconnected'))
    if (pending) return pending.promise
    const id = ++sequence
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    const timer = setTimeout(() => finish(new Error('Worker health check timed out')), timeoutMs)
    pending = { id, promise, resolve, reject, timer }
    try {
      worker.write(`ping:${id}\n`)
    } catch (error) {
      finish(error)
    }
    return promise
  }

  return { ping, close() { disconnect(); worker.destroy() } }
}

module.exports = { createWorkerClient }
