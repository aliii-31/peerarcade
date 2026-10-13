# Temporary connection recovery (Issue #19)

PeerArcade can recover a transport interruption while the **original host and guest
workers remain alive**. It does not restore sessions after process restart. Both
peers must run room protocol v2; v0.2.0 clients used protocol v1 and are incompatible
with this handshake. Invitations retain their existing format.

## What survives

For an unexpected socket close, Bare suspends the game instead of closing it.
The host retains the match ID, accepted move history/board, revision, current
turn/outcome, per-player request-ID high-water marks and cached latest outcomes.
The guest retains its accepted history and private resume credential. No state is
written to disk or exposed as a credential through Electron IPC.

`gameState()` returns null and moves are rejected while disconnected/reconnecting.
After the returning guest passes the handshake, the host sends its complete bounded
accepted history. The guest replays it using the existing engine and validates the
revision and prefix before reporting Connected / Game restored. The match ID does
not change. Completed games can also be restored; recovery never starts a new game.

The renderer clears its displayed board during recovery, disables input, ignores
old async responses, and restores only the accepted snapshot. Its existing request
counter remains increasing for the same match ID. A new match still resets it.

## Proof of the previous session

The normal invitation HMAC proof and encrypted Hyperswarm connection are required
on every connection. The host also generates a random 256-bit resume credential
on initial admission. It sends the credential **only inside the encrypted
acceptance after verifying the guest invitation proof**. The guest verifies the
host invitation proof before retaining it. The host holds it with the reserved
match; it is never logged, displayed or copied into the invitation.

For recovery, the host challenge identifies its reserved match. The guest sends
an HMAC using its retained credential, covering a fresh challenge, the match ID,
role-specific `resume-guest` domain and both current Noise connection keys. The
host verifies this against its retained credential and returns a corresponding
`resume-host` proof. The credential itself is not retransmitted during recovery.
An invitation holder without that credential cannot take the reserved
slot. Old proofs fail against a new challenge or connection. Extra simultaneous
connections are rejected; only one candidate handshake is admitted at a time.

This proves possession of the previously admitted session credential, **not a
person's identity**. Invitations are bearer secrets. The original invitation-based
first admission and host authority are unchanged; no accounts or independent
security audit are claimed.

## Bounds and lifecycle

- Recovery window: **60 seconds from the first observed unexpected disconnect**.
  Failed handshakes or extra-peer attempts do not extend it.
- Guest retries: at most **six client-swarm restart attempts**, spaced five seconds
  apart. After the final five-second attempt interval, failure is reported (about
  35 seconds if none connects), or sooner if the 60-second deadline expires.
  Stop/cleanup latency can delay attempts; the absolute deadline remains active.
- Existing Hyperswarm automatic reconnections within a live swarm may succeed
  before the next scheduled attempt. The six-attempt limit counts application
  swarm restarts, not internal DHT packets; all activity is bounded by the deadline.
- A recovery attempt destroys its old guest swarm before making a fresh one.
  Generation checks reject old callbacks. The host keeps announcing its room.
- Individual handshakes retain the ten-second timeout; a scheduled swarm restart
  can end a guest attempt earlier. JSON frames retain the 1,024-character bound.
- A successful restore cancels retry/deadline timers. A later outage gets a new
  bounded window for the same match.
- Failure clears the retained match/credential, stops networking and reports
  **Unable to reconnect**. Select Leave Room, then create/join a fresh room.
  A returning guest never silently accepts a new match when its old match vanished.

Intentional Leave sends a small `leave` control frame and drains briefly (at most
250ms) before closing sockets. It cancels all local timers/retries and discards
local recovery data. The recipient discards the match: hosts return to Waiting;
guests show Host left. If there is no usable connection or the Leave frame is
lost, the remote reservation expires within its recovery window. Leave during
recovery does not magically notify an unreachable remote peer.

App shutdown cancels room state/pending moves **before** draining queued worker
commands. This avoids waiting for a move's full timeout before shutdown cleanup.
Electron termination may close worker IPC and allow Bare to send explicit Leave;
a genuine lost transport or unreachable host without that frame uses recovery
and eventually fails. There is no host migration or process-restart recovery.

## Uncertain moves and old messages

Socket loss rejects a pending guest promise but does not imply the host rejected
the move. A move accepted just before the reply was lost is included in the
restored history. Host request-ID watermarks/cached outcomes survive, so repeating
the latest identical request cannot apply twice. Older IDs, changed payloads using
an old ID, and stale expected revisions are rejected. The renderer does not
resubmit automatically. It retrieves accepted state before another attempt.

Old sockets must match the current room, swarm generation and candidate socket
before any message is processed. Suspended game objects reject moves. Resume
replaces the transport callback but retains the same game object and host dedupe
state. Guest state is synchronized before its room status becomes connected.

## Tests and evidence

Commands (Node 22.23.3/npm 11.9.0 on macOS 14.5 arm64):

```sh
npm run check
npm test
npm run test:rooms:network
npm audit
```

This environment uses the prefix
`npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 --` before each command.

- Syntax checks passed and `npm audit` found **0 vulnerabilities**.
- **92 automated tests pass**, retaining all previous 82 tests. The existing
  malformed-frame test now waits for the explicit departure frame to be delivered;
  its cleanup assertions are retained. New deterministic cases cover preserved
  match/revision, duplicate/stale moves, wrong returning credential, repeated
  outages, retry limits, expiry, leave cancellation, unavailable host, uncertain
  accepted moves, old callbacks, expired-match refusal and UI recovery states.
- The live harness now uses `scripts/recovery-worker.mjs`, a **test-only** entry
  point that records real Hyperswarm sockets and destroys them on a private test
  IPC command. Production `p2p/main.mjs` and the preload API expose no interruption
  operation. Both Electron processes and Bare workers stay alive; only the guest's
  real established socket is destroyed.
- The final live harness run passed (exit 0). After three accepted moves, it waits for **Game restored** on both
  peers, compares the original match ID, board, revision and turn, checks duplicate
  and stale requests, then completes the same match as an X win. It also retains
  draw, invitation, admission, fresh-match-after-Leave, health and shutdown tests.
- An initial live run hit a test-driver defect: closing a temporary readline
  listener paused shared IPC. A non-pausing data listener fixed it. Another run
  exposed an obsolete expectation that Electron SIGKILL must trigger transport
  recovery; Bare handles its lost IPC by sending explicit Leave. The assertion
  now checks the expected clean host waiting state. Neither run is counted as a
  full passing integration run.
- Handled socket-error event classes on teardown remain sanitized. No invitation,
  resume credential or proof payload is logged.

This is real socket recovery evidence on one Mac, not a Wi-Fi/NAT/firewall test,
process-restart test or visible desktop E2E test. Cross-device/OS and adverse-network
soak testing remain unverified. Computer-use access returned **Computer Use
permissions are not granted**, so visible reconnection behavior remains unverified.

## Manual desktop verification

1. Use two current-code desktop instances, create/copy/join a room, and make
   several alternating moves. Note the accepted board and whose turn it is.
2. Interrupt the connection without quitting either app (for example an actual
   network interruption between separate devices). Confirm **Connection lost** /
   **Reconnecting** and a disabled board. If the connection never drops, this
   step has not tested recovery. Same-computer networking may survive Wi-Fi loss.
3. Restore connectivity within the window. Confirm **Game restored** in room
   status, the same board/turn, and that play continues to the same outcome.
4. Repeat while a move is pending; confirm its accepted mark appears at most once.
5. Keep connectivity unavailable until **Unable to reconnect**; Leave, then create
   a fresh room. Verify no old board is silently resumed.
6. Leave or close during recovery and confirm no further local retry activity.
   The unreachable peer may retain its reservation until timeout.
7. Try a different guest with the invitation while the original slot is reserved;
   it must not take over. Recheck keyboard, copy/paste and worker health controls.

No major UI redesign, storage, account, matchmaking, host migration or offline-game features
are part of this change. Official reference: [Hyperswarm API](https://github.com/holepunchto/hyperswarm),
including encrypted connection streams and join/destroy lifecycle.
