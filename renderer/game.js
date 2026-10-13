// The renderer displays accepted snapshots only. All rules stay in the worker.
(() => {
  const cells = Array.from({ length: 9 }, (_, i) => document.getElementById(`cell-${i}`))
  const status = document.getElementById('game-status')
  const player = document.getElementById('player-symbol')
  const error = document.getElementById('game-error')
  let room = { status: 'idle', role: null }
  let game = null
  let epoch = 0
  let requestId = 0
  let lastMatchId = null
  let pending = false
  let recovering = false
  let fetching = false
  let departed = false
  const symbol = () => room.role === 'host' ? 'X' : 'O'
  function render() {
    player.textContent = room.role ? `${room.role === 'host' ? 'Host' : 'Guest'} · You are ${symbol()}` : 'Choose a room to play'
    const available = room.status === 'connected' && game && !pending && !recovering &&
      game.status === 'playing' && game.currentPlayer === symbol()
    cells.forEach((cell, i) => {
      const value = game?.board[i] || ''
      cell.textContent = value
      cell.disabled = !available || !!value
      cell.setAttribute('aria-label', `Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}: ${value || 'empty'}`)
      cell.dataset.symbol = value
    })
    status.textContent = room.status === 'disconnected' ? 'Connection lost' :
      room.status === 'reconnecting' ? 'Reconnecting…' : room.status === 'failed' ? 'Unable to reconnect' : departed ? 'Opponent disconnected' : room.status === 'joining' ? 'Connecting…' :
      room.status === 'waiting' ? 'Waiting for opponent' : room.status !== 'connected' ? 'Create or join a room' :
      pending ? 'Move pending…' : recovering ? 'Checking the latest board…' : !game ? 'Loading game…' :
      game.status === 'draw' ? 'Draw' : game.status === 'won' ? (game.winner === symbol() ? 'You won' : 'You lost') :
      game.currentPlayer === symbol() ? 'Your turn' : "Opponent's turn"
  }
  function clear() {
    epoch++
    game = null
    pending = recovering = false
    error.textContent = ''
  }
  function accept(state) {
    if (!state) { clear(); return }
    if (lastMatchId !== state.matchId) {
      epoch++
      lastMatchId = state.matchId
      requestId = 0
      pending = false
    } else if (game && state.revision < game.revision) return
    game = state
  }
  async function refresh() {
    if (fetching || pending || room.status !== 'connected') return
    fetching = true
    const token = epoch
    try {
      const state = await window.peerArcade.gameState()
      if (token !== epoch || room.status !== 'connected') return
      accept(state)
      recovering = false
    } catch {
      if (token === epoch) {
        recovering = true
        error.textContent = 'Unable to refresh the board. Checking again shortly; leave the room if the connection does not recover.'
      }
    } finally { fetching = false; render() }
  }
  async function move(position) {
    if (cells[position].disabled || !game) return
    const matchId = game.matchId
    const token = ++epoch // Ignore a poll that began before this move.
    const request = { matchId, revision: game.revision, requestId: ++requestId, position }
    pending = true
    error.textContent = ''
    render()
    try {
      const state = await window.peerArcade.requestMove(request)
      if (token !== epoch || room.status !== 'connected' || game?.matchId !== matchId) return
      if (state?.matchId === matchId) accept(state)
      else recovering = true
    } catch (failure) {
      if (token !== epoch) return
      recovering = true
      error.textContent = /timed out/i.test(failure.message)
        ? 'That move took too long. Checking the accepted board before you try again.'
        : /disconnect|connected|unavailable/i.test(failure.message)
          ? 'The game connection was lost. Leave the room and connect again.'
          : 'The board changed or that move is unavailable. Checking the latest board; try an empty square on your turn.'
    } finally {
      if (token === epoch) {
        pending = false
        render()
        if (recovering) await refresh()
      }
    }
  }
  cells.forEach((cell, i) => cell.addEventListener('click', () => move(i)))
  window.peerArcadeGame = {
    reset() { clear(); departed = false; room = { status: 'idle', role: null }; render() },
    updateRoom(state) {
      if (room.status === 'connected' && state.status !== 'connected') { clear(); departed = true }
      if (state.status === 'idle') { clear(); departed = false }
      if (state.status === 'connected') departed = false
      room = state
      render()
    },
    refresh,
    unavailable() { clear(); recovering = true; room = { status: 'error', role: room.role }; departed = true; render() }
  }
  render()
})()
