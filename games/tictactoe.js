const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
]

function snapshot(board, currentPlayer, status, winner) {
  return Object.freeze({ board: Object.freeze(board), currentPlayer, status, winner })
}

function createGame() {
  let state = snapshot(Array(9).fill(null), 'X', 'playing', null)

  function getState() {
    return state
  }

  function move(position) {
    if (state.status !== 'playing') throw new Error('Game is already complete')
    if (!Number.isInteger(position) || position < 0 || position > 8) {
      throw new RangeError('Position must be an integer from 0 to 8')
    }
    if (state.board[position] !== null) throw new Error('Position is occupied')

    const board = [...state.board]
    const player = state.currentPlayer
    board[position] = player
    const won = WINNING_LINES.some((line) => line.every((cell) => board[cell] === player))
    // Check wins before draws: the last empty cell can also complete a winning line.
    const status = won ? 'won' : board.every((cell) => cell !== null) ? 'draw' : 'playing'
    const nextPlayer = status === 'playing' ? (player === 'X' ? 'O' : 'X') : null
    state = snapshot(board, nextPlayer, status, won ? player : null)
    return state
  }

  return Object.freeze({ getState, move })
}

module.exports = { createGame }
