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
  window.peerArcadeGame?.updateRoom(state)
  roomStatus.textContent = `${state.role || 'No role'} — ${state.status}: ${state.message}`
  invitationInput.value = state.invitation || ''
  const inRoom = state.status !== 'idle'
  createButton.disabled = joinButton.disabled = roomBusy || inRoom
  leaveButton.disabled = roomBusy || !inRoom
  copyButton.disabled = roomBusy || !state.invitation
}
function friendlyRoomError(error) {
  if (/Invalid invitation/i.test(error.message)) return 'Invalid invitation. Copy the complete invitation from your host and try again.'
  if (/developer discovery/i.test(error.message)) return 'Rooms are unavailable in developer discovery mode. Restart without PEERARCADE_TOPIC to play.'
  if (/full/i.test(error.message)) return 'This room already has two players. Ask the host for another room.'
  return 'Unable to complete that action. Check your connection, leave the room, and try again.'
}
async function roomAction(action) {
  if (roomBusy) return
  revision++
  window.peerArcadeGame?.reset()
  roomBusy = true
  renderRoom(snapshot)
  roomError.textContent = ''
  try { snapshot = await action() }
  catch (error) { roomError.textContent = friendlyRoomError(error) }
  finally { roomBusy = false; renderRoom(snapshot); await window.peerArcadeGame?.refresh() }
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
  const requestedAt = revision
  try { await window.peerArcade.copyInvitation(); if (requestedAt !== revision) return; roomError.textContent = 'Invitation copied. Share only with your guest.' }
  catch (error) { if (requestedAt === revision) roomError.textContent = friendlyRoomError(error) }
})
async function pollRoom() {
  if (roomBusy || polling) return
  const requestedAt = revision
  polling = true
  try {
    const state = await window.peerArcade.roomState()
    if (!roomBusy && requestedAt === revision) {
      renderRoom(state)
      await window.peerArcadeGame?.refresh()
    }
  } catch (error) {
    if (!roomBusy && requestedAt === revision) {
      roomError.textContent = friendlyRoomError(error)
      window.peerArcadeGame?.unavailable()
    }
  }
  finally { polling = false }
}
pollRoom()
const roomTimer = setInterval(pollRoom, 500)
window.addEventListener('beforeunload', () => clearInterval(roomTimer))
