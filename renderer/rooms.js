const roomStatus = document.getElementById('room-status')
const roomError = document.getElementById('room-error')
const invitationInput = document.getElementById('invitation')
const joinInput = document.getElementById('join-invitation')
const createButton = document.getElementById('create-room')
const joinButton = document.getElementById('join-room')
const copyButton = document.getElementById('copy-invitation')
const leaveButton = document.getElementById('leave-room')
let roomBusy = false
let polling = false
let revision = 0
let snapshot = { status: 'idle', role: null, invitation: null }

function renderRoom(state) {
  snapshot = state
  roomStatus.textContent = `${state.role || 'No role'} — ${state.status}: ${state.message}`
  invitationInput.value = state.invitation || ''
  const inRoom = state.status !== 'idle'
  createButton.disabled = joinButton.disabled = roomBusy || inRoom
  leaveButton.disabled = roomBusy || !inRoom
  copyButton.disabled = roomBusy || !state.invitation
}
async function roomAction(action) {
  if (roomBusy) return
  revision++
  roomBusy = true
  renderRoom(snapshot)
  roomError.textContent = ''
  try { snapshot = await action() }
  catch (error) { roomError.textContent = error.message }
  finally { roomBusy = false; renderRoom(snapshot) }
}
createButton.addEventListener('click', () => roomAction(() => window.peerArcade.createRoom()))
document.getElementById('join-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const value = joinInput.value.trim()
  roomAction(async () => {
    const result = await window.peerArcade.joinRoom(value)
    joinInput.value = ''
    return result
  })
})
leaveButton.addEventListener('click', () => roomAction(() => window.peerArcade.leaveRoom()))
copyButton.addEventListener('click', async () => {
  try { await window.peerArcade.copyInvitation(); roomError.textContent = 'Invitation copied. Share only with your guest.' }
  catch (error) { roomError.textContent = error.message }
})
async function pollRoom() {
  if (roomBusy || polling) return
  const requestedAt = revision
  polling = true
  try {
    const state = await window.peerArcade.roomState()
    if (!roomBusy && requestedAt === revision) renderRoom(state)
  } catch (error) { roomError.textContent = error.message }
  finally { polling = false }
}
pollRoom()
const roomTimer = setInterval(pollRoom, 1000)
window.addEventListener('beforeunload', () => clearInterval(roomTimer))
