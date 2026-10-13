import engine from '../games/tictactoe.js'

export function validMove(request) {
  return request && typeof request === 'object' && !Array.isArray(request) &&
    Object.keys(request).length === 4 && typeof request.matchId === 'string' && /^[a-f0-9]{64}$/.test(request.matchId) &&
    Number.isSafeInteger(request.requestId) && request.requestId > 0 &&
    Number.isInteger(request.revision) && request.revision >= 0 && request.revision <= 9 &&
    Number.isInteger(request.position) && request.position >= 0 && request.position <= 8
}

// One object per admitted connection; the rules remain in games/tictactoe.js.
export function createGameSync({ role, matchId, send, timeoutMs = 5000 }) {
  let game = engine.createGame()
  let moves = []
  let closed = false
  let pending = null
  const last = { X: 0, O: 0 }
  const cached = { X: null, O: null }
  const snapshot = () => ({ matchId, revision: moves.length, ...game.getState() })
  const envelope = (requestId = null, error = null) => ({ type: 'game-state', matchId, revision: moves.length, moves: [...moves], requestId, error })
  function settle(error, state) {
    if (!pending) return
    clearTimeout(pending.timer)
    const entry = pending
    pending = null
    error ? entry.reject(new Error(error)) : entry.resolve(state)
  }
  function apply(request, player) {
    if (!validMove(request)) throw new Error('Invalid move request')
    if (request.matchId !== matchId) throw new Error('Stale match')
    if (request.requestId === last[player]) {
      const previous = cached[player]
      if (request.position !== previous.position || request.revision !== previous.revision) throw new Error('Request ID reused with different move')
      return envelope(player === 'O' ? request.requestId : null, previous.error)
    }
    if (request.requestId < last[player]) throw new Error('Stale request ID')
    let error = null
    try {
      if (request.revision !== moves.length) throw new Error('Stale revision')
      if (game.getState().currentPlayer !== player) throw new Error('Not your turn or game complete')
      game.move(request.position)
      moves.push(request.position)
    } catch (failure) { error = failure.message }
    const result = envelope(player === 'O' ? request.requestId : null, error)
    last[player] = request.requestId
    cached[player] = { position: request.position, revision: request.revision, error }
    return result
  }
  function requestMove(request) {
    if (closed) return Promise.reject(new Error('Match disconnected'))
    if (!validMove(request)) return Promise.reject(new Error('Invalid move request'))
    if (request.matchId !== matchId) return Promise.reject(new Error('Stale match'))
    if (role === 'host') {
      try {
        const result = apply(request, 'X')
        if (!result.error) send(result)
        return result.error ? Promise.reject(new Error(result.error)) : Promise.resolve(snapshot())
      } catch (error) { return Promise.reject(error) }
    }
    if (pending) return Promise.reject(new Error('A move is already pending'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle('Move timed out; retrieve state before retrying'), timeoutMs)
      pending = { id: request.requestId, resolve, reject, timer }
      try { send({ type: 'game-move', request }) } catch { settle('Move transport unavailable') }
    })
  }
  function receive(message) {
    if (closed) return
    if (role === 'host') {
      if (message.type !== 'game-move') throw new Error('Unexpected game message')
      // Old-session packets never receive a response in the new match.
      if (message.request?.matchId !== matchId) return
      let result
      try { result = apply(message.request, 'O') }
      catch { result = envelope(Number.isSafeInteger(message.request?.requestId) ? message.request.requestId : null, 'Invalid or stale move request') }
      send(result)
      return
    }
    if (message.type !== 'game-state') throw new Error('Unexpected game message')
    if (message.matchId !== matchId) return
    if (!Array.isArray(message.moves) || message.moves.length > 9 || message.revision !== message.moves.length ||
        !(message.requestId === null || (Number.isSafeInteger(message.requestId) && message.requestId > 0)) ||
        !(message.error === null || (typeof message.error === 'string' && message.error.length <= 100))) throw new Error('Invalid game state')
    // Replay the bounded history with the same rules engine, rather than duplicating rules.
    const next = engine.createGame()
    for (const position of message.moves) next.move(position)
    if (message.moves.length < moves.length) return
    if (!moves.every((position, i) => position === message.moves[i])) throw new Error('Conflicting game history')
    moves = [...message.moves]
    game = next
    if (pending?.id === message.requestId) settle(message.error, snapshot())
  }
  return {
    getState: () => closed ? null : snapshot(), requestMove, receive,
    announce: () => send(envelope()),
    close() { closed = true; settle('Match disconnected') }
  }
}
