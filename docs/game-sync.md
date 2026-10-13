# Authoritative Tic-Tac-Toe synchronization

[Setup](../README.md) · [Rooms](rooms.md) · [Rules API](../games/README.md)

Issue #8 connects the existing rules engine to an admitted room connection.
The [Issue #9 desktop board](game-interface.md) uses the API below.
No dependencies were added and `games/tictactoe.js` is unchanged.

## Where the game runs

The host's **Bare worker** owns the official game. Host is X, guest is O.
`p2p/game-sync.mjs` imports the CommonJS rules engine using a default ES-module
import. A direct Pear Runtime/Bare probe successfully imported it and played X
at position 0 before this placement was chosen. The live integration test also
executes the engine in both real Bare processes. The engine uses plain JavaScript
and no Node-specific APIs. Bare's [module loader](https://github.com/holepunchto/bare-module)
supports CommonJS and ES modules; this does not imply arbitrary Node libraries
work in Bare.

```mermaid
sequenceDiagram
    participant UI as Guest renderer
    participant Main as Preload / Electron main
    participant Guest as Guest Bare worker
    participant Host as Host Bare worker
    UI->>Main: requestMove(request)
    Main->>Guest: validated local IPC move
    Guest->>Host: encrypted game-move proposal
    Host->>Host: Check match, ID, revision, turn; engine.move(position)
    Host-->>Guest: game-state with accepted history and revision
    Guest->>Guest: Replay accepted history using same rules engine
    Guest-->>Main: Accepted snapshot or rejection
    Main-->>UI: Resolve or reject promise
```

The host's snapshot updates locally at acceptance. Its renderer can retrieve that
snapshot through the same fixed API. Guest moves are never applied optimistically.

## Narrow desktop API

`window.peerArcade.gameState()` returns `null` outside an admitted match, otherwise:

```js
{ matchId, revision, board, currentPlayer, status, winner }
```

The board and outcome fields retain the [engine's documented meanings](../games/README.md).
`matchId` is a fresh random 32-byte hex identifier, **not** an invitation secret.
Revision starts at 0 and increases by one per accepted move, up to 9.

```js
const state = await window.peerArcade.gameState()
const accepted = await window.peerArcade.requestMove({
  matchId: state.matchId,
  requestId: 1, // Positive safe integer; increase for each new attempt in this match.
  revision: state.revision,
  position: 0 // Integer 0–8, row-major order.
})
```

Main verifies the calling window/frame, argument count, exact four-field request
shape, and field types/ranges. Bare validates again. Role is derived from the
connection, never supplied by the renderer. Fixed channels expose no generic
network send operation. Room state and health checks remain separate.

## Wire messages and conflict handling

Historical v0.2.0 room handshake version 1 required `matchId` in the host's final `ready` message.
Both instances must run this implementation; mixed pre-Issue-#8 clients are not
supported. Game frames are routed only after invitation proof and role handshake
completion, over the existing encrypted Hyperswarm socket.

- Guest proposal: `{ type: 'game-move', request: { matchId, requestId, revision, position } }`.
- Host response/update: `{ type: 'game-state', matchId, revision, moves, requestId, error }`.
  `moves` is the complete accepted list of positions (at most nine). `requestId`
  correlates a guest proposal, or is `null` for host moves/initial state. `error`
  is `null` on success or a bounded rejection string.

The accepted history is a compact representation of the official state. Both
peers use the same engine to obtain board, next player, winner and status. The
guest checks the revision equals history length and replays with the engine;
illegal histories or conflicting prefixes close the connection safely. Older
updates cannot roll state back. Other-match messages are ignored.

Host validates the expected revision, whose turn it is, and the engine's position,
occupancy and completion rules. Rejections leave the accepted history unchanged.
Each player has a monotonically increasing request ID and a one-entry cached
outcome. Repeating the latest identical request returns its outcome with the
current accepted state without applying it again. Reusing that ID with different
arguments or sending an older ID is rejected. This bounds duplicate tracking
without forgetting that older IDs have already been consumed. IDs for rejected
well-formed requests are also consumed; use a new ID for a changed attempt.

One guest move may be pending; it times out after five seconds. A timeout does
**not** prove the host rejected the move: retrieve state before deciding what to
do. Retrying the identical request ID is safe. Main bounds worker requests to
eight with eight-second timeouts; the worker bounds its command queue to sixteen.
Network frames are limited to 1,024 characters per line, including when split
across stream chunks; local command lines are limited to 2,048. Protocol JSON is
small and contains no invitation/proof logging. Invalid JSON, oversized frames,
and invalid state histories close the offending connection without crashing.

## Departure and match lifecycle

**Issue #19 update:** unexpected transport loss now suspends and restores the same
match within a bounded window. See [reconnection](reconnection.md). The behavior
below applies to intentional Leave; it describes the original v0.2.0 baseline.

Every newly admitted connection creates a fresh empty match with a new ID.
Departure destroys both peers' match objects, rejects pending moves, and returns
`null` for game state. The host waits for another guest as before. Rejoining the
same invitation creates an entirely new match; there is **no resume**, saved
history, rematch button, host migration or recovery protocol. Old socket callbacks
and old match IDs cannot modify the new match. A completed match stays available
until departure; leave/rejoin is the current way to start another.

Developer mode (`PEERARCADE_TOPIC`) retains discovery and health behavior, but
room/game operations are disabled there. Use normal room mode for this protocol.

## Verification and limitations

This evidence predates the desktop board. See [Issue #9 verification](game-interface.md#issue-9-verification) for current UI checks.

Run from the repository root with Node 22.23.3 / npm 11.9.0:

```sh
npm run check
npm test
npm run test:rooms:network
npm audit
```

The implementation was verified on macOS using the repository's existing tool
selection wrapper (`npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 --`)
before each command because the system defaults differ.

- Syntax checks passed; **69 tests passed, zero failures**. All 49 previous tests
  remain. New deterministic tests use mocked transports for alternating turns,
  initial state, all eight X-winning lines, an O win, a draw, invalid/occupied/
  out-of-turn/post-game moves, duplicates, stale revisions, timeouts, malformed
  frames, admission gating, disconnect cleanup, and session isolation.
- The real network harness launches separate **Electron processes and real Bare
  workers**, uses the public Hyperswarm DHT and encrypted sockets, and compares
  complete snapshots after every move. It passed an X win at revision 5 and draw
  at revision 9, duplicate and invalid-move rejection, third-participant rejection,
  fresh-match rejoin, stale-match rejection, both health checks and clean exits.
  It uses production main-side clients but has no BrowserWindow; this is not a
  visual or renderer-to-preload end-to-end test.
- `npm audit`: **0 vulnerabilities**. Socket error event classes occurred during
  live departures; cleanup completed and all child processes exited successfully.
- An initial new mocked rejoin test reused a destroyed fake swarm and failed;
  creating a fresh fake swarm, as production does, fixed the test fixture.
- No manual board/UI verification (no board exists), cross-device, Windows/Linux,
  adverse-network soak testing, independent protocol security audit, or reliable
  reconnection guarantee. The host is trusted as authority; this is not anti-cheat
  consensus. Invitations remain bearer secrets, not authenticated identities.
