# Developer peer-discovery test

This documents opt-in developer discovery from Issue #6. Normal users can now
use the separate [room interface](rooms.md); room operations are disabled while
`PEERARCADE_TOPIC` is set. It is not a
room system, invitation flow, matchmaking service, or playable multiplayer game.

## Run two desktop instances

Install with `npm ci` as described in the [README](../README.md). Choose a unique,
hard-to-guess topic for this test (replace the placeholder below), and run the
same command from the repository root in **two separate terminals**:

```sh
PEERARCADE_TOPIC='replace-with-the-same-unique-test-topic' npm start
```

This environment-variable syntax is for macOS/Linux shells. Windows has not been
tested. The topic is case-sensitive and whitespace is significant. It is read at
startup; restart to change it. If unset or empty, `npm start` stays offline and
continues to provide the existing local worker health check. No global topic is
used. No new dependency or global Pear installation is required.

Watch both terminals for `[P2P]` JSON events:

- `discovering`: topic lookup/announcement has started; this is not a connection.
- `announced`: the server announcement completed; this alone does not prove a peer exists.
- `connected`: Hyperswarm supplied an encrypted stream; includes the remote public
  key and active connection count. Both instances should log this event.
- `disconnected`: a socket closed, with the remaining connection count.
- `error`: includes a source (`startup`, `announce`, `swarm`, `dht`,
  `connection-attempt`, `socket`, or `shutdown`) and diagnostic message.
- `stopped`: swarm cleanup completed.

Allow time for DHT discovery. If no connection appears, confirm the topics match
and that the network permits UDP/DHT traffic. An announcement can remain pending
on a restricted network while local health checks keep working. Internal
Hyperswarm retry attempts are not all exposed as application error events.

Close one window and check the surviving instance logs `disconnected`; its
local health button should still work. Close the second window. Both processes
should exit normally. A peer closing can produce a handled socket-reset error.
Shutdown asks Bare to destroy the swarm before quitting; a bounded timeout forces
cleanup if shutdown stalls, with an error/exit rather than an indefinite hang.

## Mechanism and boundaries

Electron hashes the configured text with SHA-256 into a 32-byte topic and passes
its hex representation to Bare. `p2p/discovery.mjs` owns one Hyperswarm (maximum
eight peers), joining in both client and server modes: announce to the public
HyperDHT and look up others announcing the same topic. Hyperswarm's `connection`
event supplies a Noise-encrypted duplex stream. The wrapper logs its lifecycle.
The worker drains unsolicited bytes but implements no game-message protocol.

The implementation uses the supported APIs documented in the
[official Hyperswarm reference](https://docs.pears.com/p2p/reference/building-blocks/hyperswarm/).
No custom encryption, bootstrap service, or relay is added.

A topic is a discovery label, **not authentication or access control**. The DHT is
public; do not use sensitive text or publish a reusable shared topic. Encryption
protects transport, but it does not establish a trusted player identity. Inbound
Hyperswarm connections are not associated with a verified application room.
Peer identities are ephemeral; there is no persistent identity or peer allowlist.

Network events go to terminal logs. The UI's pong text reports only local worker
health, not peer connectivity. The preload API, game engine, and game tests are
unchanged. Room creation/invitations are implemented separately. Game synchronization,
account authentication, persistence, and playable UI remain future work.

## Actual verification

Tested on macOS with Node 22.23.3 and npm 11.9.0, using:

```sh
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm run check
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm test
```

Syntax checks passed. **34 tests passed, zero failed**, including all 28 existing
tests unchanged, five mocked lifecycle/error cases, and a real Bare invalid-config
health/shutdown test. These tests do not require public DHT connectivity.

Separately, two real Electron instances were launched with the same temporary
topic via `PEERARCADE_TOPIC=... npm exec --yes --package=node@22.23.3
--package=npm@11.9.0 -- npm start`. Both logged `announced`, `connected` (count 1),
`disconnected`, and `stopped`; both exited with code 0. Local pongs continued
while connected. One instance reported a handled `connection reset by peer`
during teardown. No mocks or local DHT substitutes were used for this test.

Evidence is from terminal logs and exit codes, not a new agent visual inspection.
This was two processes on one Mac using Hyperswarm's default public DHT, not a
cross-device or restrictive-NAT test. Encryption is provided by Hyperswarm's
supported connection stream; no independent cryptographic audit was performed.
Linux, Windows, cross-device connections, offline recovery, and varied NAT/firewall
conditions remain unverified. Network-dependent discovery timing is not guaranteed.
