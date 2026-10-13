> Release readiness: [v0.2 QA report](qa-v0.2.md) — NO-GO until manual desktop sign-off.

> Current UI verification: [Issue #9 desktop interface](game-interface.md#issue-9-verification).

> Current Issue #8 results: [game synchronization verification](game-sync.md#verification-and-limitations).
> The foundation evidence below is historical and predates rooms and synchronization.

# v0.1 verification record

This is historical evidence for the v0.1 foundation. For current Issue #6
networking results and limitations, see [peer discovery](peer-discovery.md).

[Project setup](../README.md) · [Architecture](architecture.md)

## Automated and startup checks — October 12, 2026

Verified a fresh clone of `main` at `a1b6684`, containing PRs #11, #12, and #13.
No feature-branch checkout was needed. Issue #5 changes Markdown only; the
application, lockfile, and existing game-engine API documentation are unchanged.

Environment: macOS, Node.js **22.23.3**, npm **11.9.0**. The verification used
npm's temporary tool selection because the host's default tool versions differ:

```sh
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- node --version
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm --version
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm ci
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm run check
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm test
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm start
```

These run the same repository scripts as the shorter README commands. The
wrapper is not required when compatible Node/npm versions are already active.
The fresh clone used the documented GitHub URL and explicitly selected `main`.

| Check | Actual result |
| --- | --- |
| `npm ci` | Passed; 139 packages installed, 140 audited, zero vulnerabilities reported at verification time |
| `npm run check` | Passed all configured syntax checks |
| `npm test` | 28 passed; 0 failed, skipped, or cancelled |
| `node --test test/tictactoe.test.js` | 18 game-rule tests passed (also run with the tool-selection wrapper) |
| `npm start` | Window-loaded, Bare-ready, and repeated numbered pong messages logged; process subsequently exited with code 0 |

Installation printed one package-funding notice; it produced no engine warnings
or install errors. Audit results are time-dependent and are not a security
certification. No application defect was identified during this documentation
verification.

The tests cover rules and immutability, actual Bare startup and repeated
ping/pong, stream framing, timeout/retry, and disconnection. Preload and renderer
tests use test doubles; they are not a full Electron end-to-end test. The main
process's sender-validation branches are not directly covered by those tests.

## Manual desktop evidence

Before PR #13 was merged, the project maintainer manually tested the macOS
client and confirmed both the **Check worker** success message and closing the
window normally. The expected success text was:

> Local worker ready — pong received. Networking disabled.

This is maintainer-confirmed manual evidence, not an agent visual inspection.
Agent computer-use permissions were denied during that review. Issue #5's fresh
clone launch supplied terminal/process evidence only; no new visual inspection
is claimed. The documentation-only changes do not alter that application code.

## Repeating the desktop check

After following the [setup commands](../README.md#install-and-launch):

1. Confirm the window shows **PeerArcade**, status text, and **Check worker**.
2. Click **Check worker** and confirm the success message above returns.
3. Close the window and confirm the terminal process exits normally.

If it reports unavailable, inspect terminal errors and restart the app. A
worker failure is not automatically repaired. No peer should be needed for
this local check.

## Limits and release boundary

- Linux, Windows, and WSL have not been verified.
- No packaged installer, distribution build, or automated GUI suite exists.
- GitHub Actions checks are not configured; the results above are local checks.
- There is no playable game UI, peer discovery, room joining, multiplayer state
  synchronization, authentication, or application persistence.
- The Tic-Tac-Toe rules work as a standalone module. Connect Four is not implemented.
- Successful local ping/pong does not test internet connectivity, NAT traversal,
  remote peers, or multiplayer reliability.
- v0.2 multiplayer work is planned in [Issues #6–#10](../README.md#next-milestone-v02--p2p-multiplayer).

This record supports review of the v0.1 foundation documentation. It does not
claim that a tagged release has been published.
