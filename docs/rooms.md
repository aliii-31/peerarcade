# Two-player rooms

Rooms add invitation-based host/guest pairing to the existing Bare/Hyperswarm
connection layer. They do not yet synchronize Tic-Tac-Toe moves or display a
playable board.

## Try the desktop interface

Install dependencies with `npm ci`, then run `npm start` from two terminals.
Leave `PEERARCADE_TOPIC` unset: normal room use needs no environment variables.

1. In the first window, select **Create Room**. It becomes the **host**, displays
   an invitation, and waits for a guest.
2. Select **Copy** and share the invitation privately with the other player.
3. In the second window, paste it in **Join invitation** and select **Join Room**.
   It becomes the **guest**. Both windows should reach **connected**.
4. Select **Leave Room** in the guest window. The guest returns to **idle**;
   the host waits for another guest using the same invitation.
5. Join again, then leave from the host. The guest shows **departed** and must
   leave before joining or creating another room. There is no host migration.
6. Close the windows to shut down their workers and swarms.

The host's invitation is cleared on leave, and a new host room gets a new secret.
The Copy action writes only the current host invitation to the OS clipboard; it
does not read clipboard contents. Clipboard history may retain copied invitations.

A malformed invitation is rejected without starting discovery. A well-formed but
unreachable invitation fails after 45 seconds. Pending guest lookups refresh every
five seconds so they can find a newly announced host. A handshake has a ten-second
timeout. Errors offer **Leave Room**, after which the user can retry. Status is
polled once a second, so departure messages may take a moment to appear.

Only one room per instance is supported. One host admits one guest. Additional
or duplicate transport connections are rejected without replacing the admitted
pair. A pending handshake briefly reserves the guest slot; it is released on
failure. Transport connections are not participants until the handshake completes.

## Invitations and the handshake

An invitation looks like `pa1-` followed by 64 lowercase hexadecimal characters.
Electron generates its 32 random bytes with Node's cryptographic random generator.
It derives a 32-byte discovery topic with SHA-256 and a versioned domain prefix.
The same invitation therefore leads both instances to the same topic.

The host announces that topic with Hyperswarm's server mode. The guest looks it
up in client mode. Both reuse `p2p/discovery.mjs`; networking remains inside Bare.
The public DHT locates peers, and Hyperswarm provides a Noise-encrypted stream.

Over that stream:

1. The host sends a fresh random challenge.
2. The guest sends a keyed proof that it possesses the invitation secret.
3. The host verifies it, reserves the single guest slot, and returns its own
   role-specific proof and host role.
4. The guest verifies the host proof and acknowledges the guest role.
5. The host sends a final ready message. Both report connected with complementary
   roles. The completed handshake now starts a fresh [synchronized match](game-sync.md).

Proofs use libsodium `crypto_auth`/`crypto_auth_verify` through Holepunch's
`sodium-universal`. They include the challenge, the role, and both Noise public
keys to prevent reflection/replay onto a different connection. The secret itself
is never sent in the P2P handshake. This is secret-possession checking, **not an
account system or authenticated player identity**. Anyone holding an invitation
can participate or impersonate a role, and the first valid guest wins the slot.
Share invitations only with the intended guest. There is no expiry, revocation
service, allowlist, or persistent identity; leaving the host destroys that room.

Routine logs contain event classes and role/status only, not invitations, derived
room topics, proofs, or raw remote errors. Main no longer logs raw worker IPC.
Secrets still exist in process memory, the host UI, and any clipboard copy.
Transport encryption and this small protocol have not had an independent audit.

## Files and boundaries

| File | Purpose |
| --- | --- |
| `electron/invitations.js` | Generates and validates invitations and derives topics |
| `electron/room-client.js` | Sends correlated room commands to Bare, times out requests, and holds the host's display/copy invitation |
| `electron/main.js` | Validates the source frame and allowed arguments, forwards fixed room operations, and copies only the host invitation |
| `electron/preload.js` | Exposes fixed create/join/leave/state/copy methods alongside the existing health check |
| `p2p/rooms.mjs` | Owns room state, role agreement, admission, departure, and cleanup |
| `p2p/room-proof.mjs` | Small wrapper around libsodium's keyed proofs and random challenges |
| `renderer/rooms.js` | Wires the minimal controls and polls role/status |

Health pings remain independent of room success. The game engine is unchanged.
Room messages use newline-delimited JSON with IDs over local IPC; the networking
handshake has bounded frames and deadlines. Room actions are serialized. All
existing Electron sandbox/context-isolation settings and navigation restrictions
remain enabled.

`sodium-universal` 5.0.1 was already a transitive dependency of Hyperswarm. It is
now declared directly because the room code imports it; no new package version
was added to the installed tree.

## Developer discovery compatibility

Issue #6's `PEERARCADE_TOPIC=... npm start` behavior is preserved for raw discovery
tests. **Room operations are unavailable in that mode**; restart with the variable
unset to use rooms. This prevents developer-topic connections from being treated
as room members or leaking room topics through developer diagnostic logging.
The old health tests remain, while the preload surface test now expects the five
additional fixed room methods.

## Verification

Run deterministic tests and syntax checks:

```sh
npm run check
npm test
```

The opt-in live network harness is separate:

```sh
npm run test:rooms:network
```

It launches two real Electron processes, each with a real Bare worker and the
production main-side room/health clients, using the default public DHT. A third
Electron process attempts to join the occupied room. Invitations travel through
private test-control IPC, not logs or command-line arguments. The harness runs
without browser windows: it verifies networking and Electron↔Bare communication,
not rendering, preload invocation, button clicks, or clipboard behavior.

On macOS with Node 22.23.3 and npm 11.9.0:

- Syntax checks passed; **49 automated tests passed, zero failed**. All 34 prior
  tests remain, including original health assertions; only the preload API key
  expectation was extended for the new fixed methods.
- Mocked tests cover invitation parsing, role agreement, wrong proofs, extra and
  duplicate connections, malformed frames, timeouts, retry cancellation, network
  errors, departure, cleanup, and UI control state. Real Bare tests from earlier
  issues remain in the suite.
- The live harness verified host/guest pairing, invalid-invitation rejection,
  independent health checks, rejection of a third participant, guest departure,
  rejoin, host departure, and zero exit codes for all processes.
- The first live attempt timed out before the host announcement became visible.
  Bounded lookup refresh was added; the subsequent live test passed.
- The actual desktop window was launched. Computer-use permission was denied, so
  visual controls and native clipboard behavior were not manually verified.

Testing used `npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 --`
before each npm command to select compatible tools. Normal commands above are
sufficient when the correct tools are active.

These were processes on one Mac, not separate machines. Cross-device/NAT,
Windows/Linux, and prolonged offline/reconnect behavior remain unverified.
Remote churn can temporarily occupy the handshake slot; there is no rate-limit
or abuse-protection service. Shutdown has bounded fallbacks, and a failed worker
requires app restart. Rooms are ephemeral, with no persistence, migration,
spectators, public matchmaking, or full game interface. Game synchronization is
now implemented separately in [Issue #8](game-sync.md).

The 49-test evidence above records Issue #7. Current synchronization verification
and the extended live harness are documented in [game synchronization](game-sync.md).
