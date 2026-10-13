# Desktop architecture

[Project setup](../README.md) · [Verification](verification.md) ·
[Game-engine API](../games/README.md)

## Current communication path

```mermaid
flowchart LR
    R[Renderer: page and status] -->|checkWorker| P[Preload: contextBridge]
    P -->|fixed IPC invoke| M[Electron main]
    M -->|numbered ping via Pear Runtime| B[Bare worker]
    B -->|matching pong| M
    M -->|health result| P
    P -->|resolved promise| R
    G[Standalone Tic-Tac-Toe engine: not wired to UI]
```

All arrows are communication **on one computer**. The game engine is deliberately
shown without a connection: neither the desktop UI nor the worker uses it yet.
This diagram covers local IPC only. Opt-in remote connections are described in
[peer discovery](peer-discovery.md).

## Layers and files

| Location | Responsibility |
| --- | --- |
| `renderer/index.html`, `style.css` | Heading, status text, check button, and minimal styling |
| `renderer/app.js` | Requests health checks and updates the page |
| `electron/preload.js` | Exposes only `window.peerArcade.checkWorker()` through `contextBridge` |
| `electron/main.js` | Creates the window, starts Bare, validates IPC callers, and handles shutdown |
| `electron/worker-client.js` | Matches ping/pong IDs and handles timeouts and disconnections |
| `p2p/main.mjs` | Bare entry point; answers local pings and starts discovery when configured |
| `p2p/discovery.mjs` | Hyperswarm lifecycle, connection counts, errors, and cleanup |
| `games/tictactoe.js` | Independent rules, move validation, turn order, wins, and draws |
| `test/` | Node tests for the game rules and local communication components |
| `package.json`, `package-lock.json` | Scripts, runtime requirements, and dependency versions |
| `.nvmrc`, `.gitignore` | Recommended Node version and exclusions for local/generated files |

### Runtime responsibilities

- **Electron** supplies the desktop shell and browser-style renderer. Its main
  process owns privileged application lifecycle operations.
- **Pear Runtime** is the library main uses to launch a Bare process with
  `PearRuntime.run()`. It returns a duplex stream for communication.
- **Bare** executes the worker separately from Electron. `Bare.IPC` is the other
  end of the local stream. The runtime is supplied by the transitive
  `bare-sidecar` dependency, not a separately installed global tool.
- **Hyperswarm** discovers peers and supplies encrypted connections when
  `PEERARCADE_TOPIC` is configured. Without a topic, no swarm is constructed.

The game engine uses CommonJS and has no Electron, Bare, or networking imports.
Its public API remains documented in [games/README.md](../games/README.md).

## A health check, step by step

1. The renderer calls the no-argument `checkWorker()` method. It disables the
   button while checking and shows a checking message.
2. Preload invokes the fixed `peerarcade:check-worker` channel. It does not expose
   generic send/invoke functions, Node APIs, or Electron event objects.
3. Main accepts only its own window's main frame at the expected local page URL,
   with no arguments. Unauthorized calls are rejected.
4. The worker client writes `ping:<id>` followed by a newline. Bare recognizes
   that format and replies with `pong:<id>` followed by a newline.
5. The client matches the reply to the pending check. Main returns
   `{ status: 'ready', reply: 'pong' }`, or
   `{ status: 'unavailable', reply: null }` on a worker-check failure.
6. The promise resolves through preload to the renderer, which updates the text
   and enables the button. Bridge errors also produce an unavailable message.

Stream chunks can split or combine messages, so both ends wait for complete
lines. Concurrent calls share one pending check. IDs prevent a late reply from
satisfying a later check; the timeout is three seconds. An end, close, or error
rejects pending and future checks. There is no automatic worker restart.

The renderer checks on startup, on click, and every five seconds. Closing the
window asks Bare to destroy its swarm before main closes the worker client and
quits. Shutdown is bounded by timeouts to avoid hanging on network cleanup.

## Local IPC versus future P2P

IPC means inter-process communication. Here it connects processes belonging to
one application on one machine. It requires no room, remote identity, or peer.
A successful pong confirms local worker responsiveness only.

Opt-in Hyperswarm discovery is now implemented in Issue #6. Future v0.2 work
will introduce rooms, synchronized state, and a multiplayer interface. Those capabilities are listed separately in
the [roadmap](../README.md#next-milestone-v02--p2p-multiplayer). They are not
implemented by installing Hyperswarm or by placing a worker under `p2p/`.

## Decisions and tradeoffs

| Decision | Benefit and tradeoff |
| --- | --- |
| Separate renderer, preload, main, and worker | Keeps privileged APIs out of the page and future networking isolated; adds explicit message boundaries |
| One fixed, payload-free health API | Small interface to validate; new capabilities will require deliberate API additions |
| Sandbox and context isolation enabled; Node integration disabled | Limits renderer privileges; the renderer must use the preload bridge |
| Local-only script/style CSP; navigation and new windows blocked | Suits the current local window; future external content needs explicit design |
| Numbered, newline-delimited ping/pong | No messaging dependency; intentionally limited to health checks rather than general game messages |
| Poll every five seconds; timeout after three | Simple health reporting, but failure display is not instantaneous; failed workers require an app restart |
| Plain HTML/CSS/JavaScript and Node's test runner | Few dependencies and no bundler; no hot reload or packaged distribution workflow |
| Independent, immutable Tic-Tac-Toe snapshots | Rules can be tested without the desktop; UI and network integration remain separate future work |

Pear Runtime brings storage-related transitive packages, but this application
does not instantiate its storage/updater APIs. Application persistence and
authentication are absent. Electron itself may create normal runtime cache files;
that is not a saved-game feature.

The design follows the
[official Holepunch Electron/Bare tutorial](https://docs.pears.com/p2p/getting-started/build-a-peer-to-peer-chat/build-a-peer-to-peer-chat/),
without its chat or styling framework; discovery is opt-in as documented separately. The lockfile currently resolves
Electron 44.7.0, Pear Runtime 1.3.1, and Hyperswarm 4.17.2. Electron was updated
from the tutorial's version during Issue #2 after npm audit findings; see the
[official 44.7.0 release](https://github.com/electron/electron/releases/tag/v44.7.0).
