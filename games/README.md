# Game rules

`games/tictactoe.js` is a standalone CommonJS module with no dependencies on
Electron, the UI, or networking. It does not use randomness, timers, or I/O.

## Using Tic-Tac-Toe

```js
const { createGame } = require('./games/tictactoe') // from the repository root
const game = createGame()
const initial = game.getState()
const afterX = game.move(4) // X plays the center; O is next
const afterO = game.move(0) // O plays the top-left; X is next
```

`createGame()` creates an independent game. X always starts. `getState()` returns
a read-only snapshot. `move(position)` plays for the current player and returns
the new snapshot. Old snapshots never change, so callers can compare before and
after safely. Create another game to start over.

The board is a flat array of nine cells, with `null` for empty cells:

```text
0 | 1 | 2
3 | 4 | 5
6 | 7 | 8
```

Each snapshot has four fields:

| Field | Meaning |
| --- | --- |
| `board` | Nine cells containing `null`, `'X'`, or `'O'` |
| `currentPlayer` | Next player (`'X'` or `'O'`), or `null` after completion |
| `status` | `'playing'`, `'won'`, or `'draw'` |
| `winner` | Winning symbol, or `null` while playing or after a draw |

Only integer positions from 0 through 8 are accepted; values are not converted
from strings. Invalid positions throw `RangeError`. Occupied cells and moves
after completion throw `Error`. Rejected moves leave state and turn unchanged.
Completion is checked before position validation.

After every valid move, the engine checks all eight winning lines, then checks
for a full board. This order ensures a winning ninth move is not called a draw.
Turns alternate only while play continues. Both the snapshot and its board are
frozen; callers must use `move()` rather than modifying cells directly.

## Tests and boundaries

Run `npm test` for the full suite, or `node --test test/tictactoe.test.js` for
just the rules. Tests cover initial state, turns, invalid and occupied positions,
all eight winning lines, an O win, draws, last-cell wins, post-game rejection,
immutable snapshots, independent games, and deterministic replay.

The engine does not identify or authenticate players, import arbitrary saved
states, or enforce network ownership of a turn. Those concerns belong outside
the rules module and are not part of Issue #3. No UI integration is included.
