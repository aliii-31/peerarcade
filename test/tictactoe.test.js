'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createGame } = require('../games/tictactoe')

function play(positions) {
  const game = createGame()
  for (const position of positions) game.move(position)
  return game
}

test('new games have independent empty boards and X starts', () => {
  const game = createGame()
  assert.deepEqual(game.getState(), {
    board: Array(9).fill(null), currentPlayer: 'X', status: 'playing', winner: null
  })
  game.move(0)
  assert.deepEqual(createGame().getState().board, Array(9).fill(null))
})

test('valid moves update only the selected cells and alternate turns', () => {
  const game = createGame()
  const first = game.move(0)
  assert.deepEqual(first.board, ['X', null, null, null, null, null, null, null, null])
  assert.equal(first.currentPlayer, 'O')
  const second = game.move(8)
  assert.deepEqual(second.board, ['X', null, null, null, null, null, null, null, 'O'])
  assert.equal(second.currentPlayer, 'X')
  assert.equal(second.status, 'playing')
  assert.equal(second.winner, null)
  assert.equal(first.board[8], null)
})

test('occupied cells are rejected without changing state or consuming a turn', () => {
  const game = play([4])
  const before = game.getState()
  assert.throws(() => game.move(4), /occupied/)
  assert.equal(game.getState(), before)
  assert.equal(game.move(0).board[0], 'O')
})

test('invalid positions are rejected without changing state', () => {
  const game = createGame()
  const before = game.getState()
  for (const position of [-1, 9, 100, 0.5, NaN, Infinity, -Infinity, '0', null, undefined, true, {}, [], 1n]) {
    assert.throws(() => game.move(position), RangeError)
    assert.equal(game.getState(), before)
  }
})

const wins = [
  [0, 3, 1, 4, 2], [3, 0, 4, 1, 5], [6, 0, 7, 1, 8],
  [0, 1, 3, 2, 6], [1, 0, 4, 2, 7], [2, 0, 5, 1, 8],
  [0, 1, 4, 2, 8], [2, 0, 4, 1, 6]
]
for (const [index, moves] of wins.entries()) {
  test(`detects winning combination ${index + 1}`, () => {
    const game = play(moves.slice(0, -1))
    assert.equal(game.getState().status, 'playing')
    const state = game.move(moves.at(-1))
    assert.equal(state.status, 'won')
    assert.equal(state.winner, 'X')
    assert.equal(state.currentPlayer, null)
  })
}

test('O can win too', () => {
  const state = play([0, 3, 1, 4, 8, 5]).getState()
  assert.equal(state.status, 'won')
  assert.equal(state.winner, 'O')
  assert.equal(state.currentPlayer, null)
})

test('full board without a winning line is a draw', () => {
  const game = play([0, 1, 2, 4, 3, 5, 7, 6])
  assert.equal(game.getState().status, 'playing')
  assert.deepEqual(game.move(8), {
    board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'],
    currentPlayer: null, status: 'draw', winner: null
  })
})

test('a win on the ninth move takes precedence over a draw', () => {
  const state = play([0, 1, 4, 2, 5, 3, 6, 7, 8]).getState()
  assert.equal(state.status, 'won')
  assert.equal(state.winner, 'X')
})

test('moves after either a win or draw are rejected without state changes', () => {
  for (const game of [play(wins[0]), play([0, 1, 2, 4, 3, 5, 7, 6, 8])]) {
    const before = game.getState()
    for (let position = 0; position < 9; position++) {
      assert.throws(() => game.move(position), /already complete/)
      assert.equal(game.getState(), before)
    }
  }
})

test('callers cannot mutate state or the board', () => {
  const game = createGame()
  const state = game.getState()
  assert.throws(() => { state.board[0] = 'O' }, TypeError)
  assert.throws(() => { state.currentPlayer = 'O' }, TypeError)
  assert.equal(game.move(0).board[0], 'X')
})

test('replaying the same sequence produces the same state', () => {
  assert.deepEqual(play([4, 0, 8, 2]).getState(), play([4, 0, 8, 2]).getState())
})
