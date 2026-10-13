# v0.3 — Reliability & Recovery QA

## Recommendation

**GO for release preparation, with maintainer acceptance of the desktop verification gap.**
Automated regression and controlled real-network tests pass. No production defect
was established. Visible reconnection gameplay remains **BLOCKED / NOT VERIFIED**
because computer use returned `Computer Use permissions are not granted`.

After reviewing the QA outcome, the maintainer instructed: “okay lets fix the
release recommendation to remove no go”. This is recorded as acceptance of the
remaining desktop verification gap, not confirmation that specific GUI scenarios
passed. The earlier plan to test personally and the v0.2 manual sign-off are not
new v0.3 test evidence. The evidence matrix and manual checklist remain unchanged.

The recommendation is now **GO** on that basis. No merge, tag or release is
authorized or performed by this documentation update.

## Environment and revision

- Run date: October 12, 2026, America/New_York (some logs cross into October 13 UTC).
- macOS 14.5 (23F79), arm64; one Mac and its available internet connection.
- Node 22.23.3, npm 11.9.0, Electron 44.7.0, Pear Runtime 1.3.1,
  Hyperswarm 4.17.2.
- Latest main inspected: `aea2a8d8ecc6e3ad7dee51ceb6e8997eb5d5daab`, including PR #26.
- Exact code/metadata revision tested: `e6860b5533b0fe234180e624cdb79c1bab0b14e8`.
  Subsequent changes in this PR are documentation only. Installation and desktop
  profile diagnostics ran on the base application; application and dependencies
  are unchanged. The expanded network suite, syntax checks, tests and audit ran
  with the 0.3.0 metadata and final test infrastructure.

## Reproduction and results

Use the repository root. These are the executed commands; in this environment each
npm command used the prefix
`npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 --`
to select the documented tools.

| Command | Result |
| --- | --- |
| `npm ci` | PASS: 139 packages installed, 140 audited; one funding notice; no vulnerabilities |
| `npm run check` | PASS: all configured syntax checks, including test harnesses |
| `npm test` | PASS: 92 tests, 0 failed/skipped/cancelled; final run 478.213 ms |
| `npm run test:rooms:network` | PASS: expanded real Electron/Bare/Hyperswarm suite; exit 0 |
| `npm run test:desktop:profiles` | PASS for startup/exit: four production windows loaded; all Electron/Bare exits 0; shared-profile cache warnings separately recorded below |
| `npm audit` | PASS: 0 vulnerabilities at execution time |
| `git diff --check` | PASS: no whitespace errors |

The lockfile root and root-package version both match package.json at 0.3.0;
dependency declarations and resolutions did not change. Audit is time-dependent
and is not a security certification.

## Evidence matrix

| Scenario | Status | Evidence and boundary |
| --- | --- | --- |
| Existing rules, UI state, protocol and recovery regression | PASS | 92 Node tests retained; deterministic doubles for difficult failure cases, real Bare health tests |
| Initial roles, invalid invitation, occupied-room third peer | PASS | Independent Electron/Bare processes, real encrypted Hyperswarm streams |
| Three interruptions in one ongoing match | PASS | Destroy established guest socket with both workers alive; both log disconnected; same match ID, board, revision, turn and accepted history restored each time |
| Resource counts after each restoration | PASS | Exactly one tracked socket and zero direct room/game timers per peer after each cycle |
| Continued X win and separate draw | PASS | Both peers agree on authoritative outcome and revisions 5 and 9 |
| Duplicate request and stale revision after recovery | PASS | Latest duplicate does not apply twice; superseded IDs and stale revisions reject without changing state |
| Uncertain move accepted, response lost | PASS | Suppress one host game-state frame, interrupt; restored revision includes the move; repeat request does not increment it again |
| Uncertain move never accepted | PASS | Suppress one outbound guest proposal, interrupt; restored history excludes it; retry applies it once |
| Recovery slot hijack using invitation only | PASS | Third live peer rejected while original guest transport is blocked |
| Retry exhaustion and fresh room | PASS | Block guest transport delivery through production retry budget; failed state, null game, rejected move, zero tracked timers/sockets; Leave/create/join starts revision 0 |
| Leave during recovery | PASS | Immediate local timer cancellation and idle state; both peers subsequently create/join successfully |
| Normal exit and abrupt guest Electron termination | PASS | Normal Electron/Bare exits; guest SIGKILL causes Bare IPC cleanup/Leave, responsive surviving host and cleared match; tracked Bare PIDs no longer exist |
| Old callbacks, expired matches and unavailable host | PASS | Existing deterministic tests; not a claim of actual internet partition testing |
| Routine log secret patterns | PASS | No invitation or 64-hex credential/proof-shaped values detected during final live suite; pattern screening is not a formal confidentiality audit |
| Isolated-profile production desktop startup | PASS | Two production BrowserWindows load and exit normally without cache warnings |
| Shared-profile Chromium cache integrity | FAIL | Cache-open / critical-error diagnostics reproduce; both windows still load and exit 0; non-blocking finding below |
| Visible recovery, click/keyboard/clipboard and outcome interaction | BLOCKED | Computer-use permission denied; startup logs and headless network harness cannot establish GUI behavior |
| Cross-device, restrictive NAT/firewall, Wi-Fi loss, Windows/Linux, long soak | BLOCKED | Not exercised in this environment; no coverage claimed |

## Fault injection and limits

`scripts/recovery-worker.mjs` is a test-only entry point. It wraps real Hyperswarm
sockets to destroy an established stream, suppress one selected protocol frame,
or reject subsequent transport connections. Production networking, renderer and
preload APIs are unchanged. This tests application behavior over real connections
with controlled faults; it is **not** an actual Wi-Fi outage or internet partition.
The live harness runs Electron without BrowserWindow.

For recovery failure, blocked connection delivery lasts through the guest's normal
six five-second restart attempts (failure around 35 seconds, bounded by the
60-second recovery window). State waits and RPCs have explicit deadlines. Internal
Hyperswarm connection attempts are not counted as application retry attempts.

Timer instrumentation counts only timers directly created by `p2p/rooms.mjs` and
`p2p/game-sync.mjs`, verified by observing a nonzero recovery deadline count before
cleanup. It does not prove the absence of every internal DHT timer, heap leak or
OS resource. Socket counts and worker PID disappearance provide additional bounded
cleanup evidence, not a long-duration leak test.

## Investigations and sanitized failure evidence

### Shared profile cache warnings — non-blocking

Reproduce with `npm run test:desktop:profiles`. It starts two production windows
sharing a disposable profile, then two with independent profiles. The shared pair
reported examples such as:

```text
Failed to open <qa-temp>/shared/GPUCache/data_0
Failed to open <qa-temp>/shared/DawnWebGPUCache/data_1
Failed to open <qa-temp>/shared/DawnGraphiteCache/data_0
Critical error found -8
```

All four windows loaded; all Electron/Bare processes exited 0. Isolated profiles
had no such cache diagnostics. This isolates profile sharing as the trigger in
this run but does not demonstrate broken game behavior or a crash. Use isolated
profiles for local multi-instance QA. No speculative application change was made.
Long-duration shared-profile behavior remains unverified.

### Development runs of the expanded harness

Two initial runs failed assertions before the final passing suite:

- `2 !== 0`: the first timer counter matched any room frame in a stack and also
  counted nested DHT timers. Restricting it to the direct timer caller corrected
  the measurement; no production timer behavior changed.
- `Invalid or stale move request`: the second recovery cycle replayed an ID older
  than a newer rejected request already recorded by the host. The protocol
  correctly rejected it. The test now expects rejection for superseded IDs and
  still checks idempotence of the latest identical request.

These failed runs are not counted as passes. They were test-instrumentation and
expectation defects, not reproduced application defects.

### Teardown socket errors

Controlled interruption and rejected connection attempts can emit sanitized:

```text
[Room] {"event":"error","where":"socket"}
[Room] {"event":"transport-disconnected"}
```

In these runs, recovery or the expected bounded failure followed; health checks
and normal cleanup succeeded. These handled event classes were not unhandled
exceptions or process crashes. The deliberately SIGKILLed Electron guest is the
exception to normal exit: its worker still cleaned up and exited. This case does
not substitute for a machine/host outage because IPC closure permits explicit Leave.

## Manual desktop checklist

Use this PR's code with `npm ci`. In each of two terminals launch an independent
profile (the temporary directories may be removed after both applications exit):

```sh
npm start -- --user-data-dir="$(mktemp -d)"
```

1. Host: Create Room and Copy. Guest: paste the invitation and Join. Check X/O roles,
   worker pong, and alternate at least three moves. Record board and turn.
2. Interrupt the transport while both original apps/workers stay alive. For a real
   network check, run peers on separate devices and temporarily interrupt the
   path between them. A same-Mac Wi-Fi toggle may leave the socket alive; if no
   disconnected status appears, recovery has not been tested. The test-only socket
   injector is not exposed in the production GUI.
3. Observe Connection lost / Reconnecting and disabled board. Restore the path
   within the recovery window. Observe Game restored, original board/turn and
   continue to a win or draw on both windows.
4. Repeat around a pending move; confirm at most one accepted mark and agreement.
5. Keep the path unavailable until Unable to reconnect. Verify disabled moves,
   then Leave and create/join a fresh empty match after restoring connectivity.
6. Repeat loss and intentionally Leave or close during recovery. Confirm local
   retries cease, shutdown completes, and the remaining app stays responsive.
   An unreachable peer can retain its reservation until its deadline expires.
7. Check keyboard interaction, copy/paste, room controls and a third guest's
   rejection while the original slot is reserved. Never paste invitations into
   public evidence. Record actual scenarios, platform and observed results.

These steps remain pending maintainer testing, not asserted results. The maintainer
has accepted this verification gap for the GO recommendation above. Record actual
results here when testing is completed. Cross-device execution of this checklist
would add coverage only after it actually occurs.

## Remaining risks

The maintainer has accepted the remaining desktop verification gap; it is no longer
a release gate. No critical application defect was established by the completed tests. Coverage is
limited to one Mac, bounded runs and controlled faults. Recovery requires the
original host and guest workers, protocol v2 on both peers, and the retained
in-memory session credential. v0.2.0 protocol v1 is incompatible. There is no
process-restart recovery, persistence, host migration or personal authentication.
Future QA can add cross-device/NAT/platform matrices and longer soak runs; no new
product feature or independent issue is introduced here.
