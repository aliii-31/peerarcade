# Playing Tic-Tac-Toe

Launch `npm start` in two terminals from the repository root. Use normal room
mode: remove `PEERARCADE_TOPIC` from your environment if it is set. Both instances
must use the same current code. Networking requires internet connectivity.

## Manual desktop verification

1. In the first window, select **Create Room**, then **Copy**. Expect Host / X
   and Waiting for opponent. The empty board must be disabled.
2. Paste the invitation into the second window and select **Join Room**. Expect
   Guest / O. Once connected, the host sees Your turn, and the guest sees
   Opponent's turn. The guest's board must be disabled.
3. Play this sequence (positions counted left to right, top to bottom):
   host top-left, guest middle-left, host top-center, guest center, host top-right.
   After every click, the accepted mark must appear in both windows. Occupied
   cells cannot be selected. While a request is pending, the entire board is
   disabled and no speculative mark is shown.
4. Verify **You won** on the host and **You lost** on the guest. Both boards
   should be disabled with the same five marks.
5. Have the guest leave. The host should show **Opponent disconnected** with an
   empty, disabled board. Rejoin with the same invitation and verify a fresh
   empty board; there is no rematch or resume feature.
6. For a draw, play positions `0,1,2,4,3,5,7,6,8`, alternating host/guest.
   Both windows should show **Draw** with no enabled cells.
7. Leave again and try an invalid invitation. Expect a helpful error. Test
   closing either window during a match; the remaining window must clear the
   board and report departure once transport disconnection is detected.
8. Check keyboard Tab/Enter interaction, visible focus, and labels; narrow the
   window below 640px to check the stacked layout. Check worker should still
   return pong. Close both windows when finished.

A failed join can take up to the existing room timeout. Leave and try again.
Invitations are bearer secrets; share them privately and avoid including them in
screenshots or reports. A completed match remains visible until departure.

## How the board stays synchronized

`renderer/game.js` uses only the existing fixed preload operations. It sends the
accepted match ID and revision with a monotonically increasing request ID. IDs
reset only when the match ID changes, including when a failed room action returns
to the same match. It displays the host-accepted snapshot returned by the worker;
it never computes new game rules or places a mark optimistically.

The existing room poll now runs every 500ms and retrieves game state only while
connected. Room polls do not overlap; game refreshes have their own overlap guard
and are skipped while a move is pending. A generation counter discards responses
that began before a room action or newer move. Lower revisions cannot overwrite
a newer accepted board. Departure clears the board and pending state.

A rejected or timed-out move locks the board while retrieving the current
accepted state. If retrieval fails, the board stays locked until a later refresh
succeeds. A timeout does not establish whether a move was accepted. There is no
automatic move retry or host migration. [Issue #19 recovery](reconnection.md) now
restores temporary transport interruptions without changing the match.

The HTML adds labelled native cell buttons and live status text. CSS provides a
responsive two-panel layout, visible keyboard focus, and restrained X/O colors.
Room controls retain their existing behavior with friendlier action errors and
protection against late clipboard/poll messages. The rules engine, networking,
room handshake, preload API and worker health behavior are unchanged.

## Issue #9 verification

On macOS, using Node 22.23.3 / npm 11.9.0 via
`npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 --`:

- `npm run check`: passed.
- `npm test`: **82 passed, 0 failed**, preserving all 69 existing tests. New VM
  tests use fake DOM elements and preload responses; they cover initial state,
  symbols, turns, accepted remote updates, pending/rejected moves, timeout
  recovery, win/loss/draw, departures, fresh-match IDs and stale async responses.
- `npm run test:rooms:network`: real Electron/Bare/Hyperswarm harness passed.
  This verifies network synchronization and cleanup, **not desktop UI interaction**.
- `npm audit`: 0 vulnerabilities. No new dependencies.
- Two normal `npm start` Electron processes were launched and each reported
  `PeerArcade window loaded`. Computer-use access returned **Computer Use
  permissions are not granted**. Visual layout, actual board clicks, clipboard
  copy/paste, keyboard operation and the complete two-window user flow remain
  **unverified**. No screenshots were captured.
- One desktop process logged Chromium disk-cache errors (`Critical error found -8`,
  `Failed to save user data`) after loading. Simultaneous instances may share the
  default Electron profile; the cause and impact on desktop interaction were not
  verified. No application/network behavior was changed to address this warning.
- The real networking harness logged handled socket error events during departure
  and completed with clean exits.

The manual checklist above must be performed before claiming complete desktop
E2E verification. Cross-device/OS testing and adverse-network testing remain
outside this evidence. See [synchronization](game-sync.md) for protocol limits.
