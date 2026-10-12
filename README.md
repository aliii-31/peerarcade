# PeerArcade

PeerArcade is a desktop mini-arcade being built toward peer-to-peer multiplayer
with Holepunch technology. The current **v0.1 game foundation** contains:

- An Electron window with a local Bare-worker health check.
- A restricted renderer → preload → main → worker communication path.
- A standalone, tested Tic-Tac-Toe rules engine, not connected to the window.

**There is no playable game UI or multiplayer yet.** Peer discovery, rooms,
game-state synchronization, authentication, application persistence, and Connect
Four are not implemented.

## Prerequisites

- Git.
- Node.js **22.17.0 or newer** and npm **10.9.0 or newer**.
- Recommended and tested: Node **22.23.3** (recorded in `.nvmrc`) and npm **11.9.0**.
- A graphical desktop session. macOS has been tested; Linux, Windows, and WSL
  have not. WSL would also need a working graphical environment.
- Internet access to install packages and download Electron's platform binary.

Confirm the active tools before installing:

```sh
node --version
npm --version
```

A global Pear CLI or separate Bare installation is not required. Pear Runtime
supplies the Bare sidecar through its dependencies.

## Install and launch

```sh
git clone https://github.com/aliii-31/peerarcade.git
cd peerarcade
npm ci
npm start
```

These commands use the repository's default `main` branch; no feature-branch
checkout is needed. `npm ci` installs the committed lockfile's dependency versions.
Electron may download its binary on first launch.

The window displays **PeerArcade** and a **Check worker** button. Click it to
request a local ping/pong. Success reads:

> Local worker ready — pong received. Networking disabled.

Checks also run at startup and every five seconds. Close the window to quit.
Restart after code changes; there is no automatic reload or build step. If the
worker reports unavailable, restart the application and inspect terminal errors.
This status describes a local process, not a connection to another player.

## Run checks

From the repository root:

```sh
npm run check
npm test
```

`check` runs the configured JavaScript syntax checks. `test` uses Node's built-in
test runner for game rules, Bare startup and ping/pong, failure handling, and
isolated bridge/renderer behavior. It is not an automated desktop UI test.

## Documentation

- [Architecture and design decisions](docs/architecture.md)
- [Tic-Tac-Toe state model and API](games/README.md)
- [Verification evidence and limitations](docs/verification.md)

## Next milestone: v0.2 — P2P Multiplayer

The following work is **planned, not implemented**:

1. [Peer discovery with Hyperswarm (#6)](https://github.com/aliii-31/peerarcade/issues/6)
2. [Create and join rooms (#7)](https://github.com/aliii-31/peerarcade/issues/7)
3. [Synchronize game state (#8)](https://github.com/aliii-31/peerarcade/issues/8)
4. [Build a multiplayer game interface (#9)](https://github.com/aliii-31/peerarcade/issues/9)
5. [End-to-end multiplayer QA (#10)](https://github.com/aliii-31/peerarcade/issues/10)

The v0.1 foundation makes that work possible; local ping/pong does not prove
peer discovery, internet connectivity, or multiplayer reliability.
