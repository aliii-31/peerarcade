const status = document.getElementById('worker-status')
const button = document.getElementById('check-worker')

async function checkWorker() {
  if (button.disabled) return
  button.disabled = true
  status.textContent = 'Checking local worker…'
  try {
    const result = await window.peerArcade.checkWorker()
    status.textContent = result.status === 'ready' && result.reply === 'pong'
      ? 'Local worker ready — pong received.'
      : 'Local worker unavailable. Try checking again.'
  } catch {
    status.textContent = 'Local worker unavailable. Try checking again.'
  } finally {
    button.disabled = false
  }
}

button.addEventListener('click', checkWorker)
checkWorker()
// Refresh health so a worker exit is reflected even without a button press.
const healthTimer = setInterval(checkWorker, 5000)
window.addEventListener('beforeunload', () => clearInterval(healthTimer))
