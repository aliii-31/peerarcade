# PeerArcade

A peer-to-peer mini-arcade in development. Issue #2 provides only a desktop
window and a local Bare worker. Games, discovery, rooms, synchronization,
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
# Until Issue #2 is merged:
git switch setup/issue-2-development-environment
npm ci
npm start
```

A window displays **PeerArcade**. The terminal should print
`PeerArcade worker ready (networking disabled)` and `PeerArcade window loaded`.
Close the window to quit the app and stop its worker. `npm run dev` is an alias
for `npm start`; there is no bundler or automatic reload. Restart after edits.
Electron may download its platform binary on first launch.

`npm ci` installs the exact dependency tree from `package-lock.json`.
Use `npm install` when deliberately updating dependencies, and commit the lockfile.
Neither a global Pear CLI nor a separate Bare installation is required.

## Architecture and layout

```text
electron/main.js       Desktop window, worker startup, and shutdown
renderer/index.html    Static application UI
renderer/style.css     Minimal local styling
games/                 Reserved for UI-independent game rules
p2p/main.mjs           Bare worker; future networking belongs here
test/worker.test.js    Real Bare startup and dependency-loading smoke test
package.json           Dependencies, runtime requirements, npm commands
package-lock.json      Reproducible dependency versions
.nvmrc                 Recommended Node version
.gitignore             Dependencies, secrets, logs, and generated artifacts
```

Electron creates the desktop window and displays ordinary HTML. Pear Runtime
starts a separate Bare process, where future networking code will live. The
worker currently imports Hyperswarm and sends one readiness message to Electron;
it never constructs a swarm or joins a topic. Game rules have their own folder.
The renderer is sandboxed, with Node integration disabled and context isolation
enabled. A restrictive content security policy allows only local CSS. A preload
bridge can be added when the UI actually needs to exchange messages.

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
It does not test games, network connectivity, or the GUI. There is no build step.

Verification on macOS with Node 22.23.3 and npm 11.9.0: clean `npm ci`, syntax
checks, and the worker test passed; audit reported zero vulnerabilities.
Electron launched and reported worker readiness. Visual window inspection was
unavailable because computer-use permissions were pending. Manually confirm the
PeerArcade heading appears when reviewing this change.
