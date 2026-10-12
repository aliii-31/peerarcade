# PeerArcade

A peer-to-peer mini-arcade in development. The desktop shell and local Bare
worker are joined by a standalone [Tic-Tac-Toe engine](games/README.md). The
engine is not yet connected to the UI. Discovery, rooms, synchronization,
authentication, and application persistence are not implemented.

## Prerequisites

- Node.js **22.17.0 or newer** and npm **10.9.0 or newer**.
- Recommended/tested: Node.js **22.23.3** (see `.nvmrc`) and npm **11.9.0**.
- Git and a desktop graphical session. Development was exercised on macOS;
  Linux and Windows have not been verified. WSL requires a working GUI setup.
- Internet access for npm packages and Electron's initial binary download.

If you use nvm, run `nvm install` followed by `nvm use` in this directory.
Check `node --version` and `npm --version` before installing.

## Install and start

```sh
git clone https://github.com/aliii-31/peerarcade.git
cd peerarcade
npm ci
npm start
```

A window displays **PeerArcade**, a local-worker status, and a **Check worker**
button. On success it shows “Local worker ready — pong received. Networking
disabled.” Checks run at startup, on click, and every five seconds. A failed or
three-second timed-out check shows “Local worker unavailable.” This is local
process health, not a connection to another player.
Close the window to quit the app and stop its worker. `npm run dev` is an alias
for `npm start`; there is no bundler or automatic reload. Restart after edits.
Electron may download its platform binary on first launch.

`npm ci` installs the exact dependency tree from `package-lock.json`.
Use `npm install` when deliberately updating dependencies, and commit the lockfile.
Neither a global Pear CLI nor a separate Bare installation is required.

## Architecture and layout

```text
electron/main.js       Window, validated IPC handler, and worker lifecycle
electron/preload.js    Narrow bridge available to the sandboxed renderer
electron/worker-client.js  Ping correlation, timeout, and disconnect handling
renderer/index.html    Heading, health status, and check button
renderer/app.js        Requests checks and updates the visible status
renderer/style.css     Minimal local styling
games/                 Standalone Tic-Tac-Toe rules and API documentation
p2p/main.mjs           Bare worker; future networking belongs here
test/                  Game-rule tests and Bare startup smoke test
package.json           Dependencies, runtime requirements, npm commands
package-lock.json      Reproducible dependency versions
.nvmrc                 Recommended Node version
.gitignore             Dependencies, secrets, logs, and generated artifacts
```

### Four application layers

```text
Renderer → Preload → Electron main → Bare worker
Renderer ← Preload ← Electron main ← Bare worker
```

1. **Renderer** (`renderer/app.js`) updates the page and calls
   `window.peerArcade.checkWorker()`. It has no Node or worker access.
2. **Preload** (`electron/preload.js`) uses `contextBridge` to expose that single
   no-argument method. It invokes the fixed `peerarcade:check-worker` channel;
   callers cannot choose channels or forward arbitrary payloads.
3. **Main** (`electron/main.js`) owns the window and worker. It checks that IPC
   comes from this window's main frame at the local renderer URL, with no arguments.
   The helper `electron/worker-client.js` sends a numbered ping and waits for its
   matching pong, returning `{ status: 'ready', reply: 'pong' }` or, on failure,
   `{ status: 'unavailable', reply: null }` to the page through the preload promise.
4. **Bare** (`p2p/main.mjs`) accepts only newline-delimited `ping:<id>` messages
   and answers `pong:<id>`. It imports Hyperswarm but never creates a swarm.

Stream chunks are not message boundaries, so both ends accumulate complete lines.
The client shares one pending check, times out after three seconds, ignores stale
reply IDs, and rejects checks when the worker disconnects. Quit closes the worker
and clears any pending check. Restart the application after a worker failure;
there is no automatic worker restart in this issue.

This separation keeps privileged desktop code out of the page and leaves future
networking in its own process. `games/tictactoe.js` stays independent and unchanged.
Context isolation, renderer sandboxing, and disabled Node integration remain in
place. The CSP permits local scripts/styles only; navigation and new windows are
blocked. No new dependencies, persistence, or multiplayer features are introduced.

Direct dependencies resolved in the lockfile:

- **electron 44.7.0** (development): desktop shell used by `npm start`.
- **pear-runtime 1.3.1**: starts the Bare worker through `PearRuntime.run()`.
- **hyperswarm 4.17.2**: reserved for future P2P networking; currently load-checked only.

Bare is supplied transitively by Pear Runtime's `bare-sidecar` package. No direct
Bare package, UI framework, buffer helper, database, or build system is needed.
Some storage-related packages are transitive dependencies of Pear Runtime;
this app does not instantiate its storage or updater APIs.

The architectural reference is the official
[Pear getting-started tutorial](https://docs.pears.com/p2p/getting-started/build-a-peer-to-peer-chat/build-a-peer-to-peer-chat/).
Its Electron 40 range triggered high-severity audit findings during setup, so this
project uses the official [Electron 44.7.0 release](https://github.com/electron/electron/releases/tag/v44.7.0).
The chat-specific features and styling framework are intentionally omitted.

## Verification

```sh
npm run check
npm test
npm audit
npm start
```

`check` validates JavaScript syntax. `test` launches a real Bare worker and checks
that Hyperswarm imports and the readiness message arrives, without discovery.
The suite also tests the standalone Tic-Tac-Toe rules. Network connectivity and
the GUI are not tested automatically. There is no build step.

Verification on macOS with Node 22.23.3 and npm 11.9.0: clean `npm ci`, syntax
checks, and the worker test passed; audit reported zero vulnerabilities.
Electron launched and reported worker readiness. Visual window inspection was
unavailable because computer-use permissions were pending. Manually confirm the
PeerArcade heading appears when reviewing this change.

Issue #4 verification includes real Bare ping/pong tests, client stream framing,
timeouts/retries/disconnection, and isolated preload/renderer tests. The latter
use small test doubles; they do not replace a real desktop UI check. The desktop
was launched on macOS and logged renderer-triggered pong responses. Visual status
and button interaction could not be inspected because computer-use permissions
were denied. Linux and Windows remain unverified.
