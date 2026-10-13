# v0.2.0 — P2P Multiplayer release QA

**Recommendation: GO based on maintainer manual sign-off and passing automated
and real-network evidence.** The maintainer confirmed in the release-preparation
request that they manually verified the desktop product and approved proceeding
toward release. This is maintainer-provided verification, not an agent-performed
GUI test. No scenario-by-scenario results, screenshots, test environment or exact
manual-test commit were supplied, so individual checklist items are not newly
marked PASS. The prior agent GUI permission limitation remains part of the
historical evidence below. No release has been tagged or published by this work.

## Release-preparation recheck

Starting from merged main `95e60b02a702cd3ba29a70ef7506fc0ffc72b861`, the
`release/prepare-v0.2.0` branch changes only version metadata and documentation.
`package.json` and both root lockfile version fields now read `0.2.0`; dependency
versions are unchanged. With the same Node 22.23.3/npm 11.9.0 command prefix below:

- `npm run check`: passed (exit 0).
- `npm test`: 82 passed, 0 failed/skipped/cancelled (exit 0).
- `npm run test:rooms:network`: passed (exit 0), including win/draw synchronization,
  admission, fresh-match rejoin, forced guest disconnection and clean normal exits.
- `npm audit`: 0 vulnerabilities (exit 0).

Handled socket error events occurred around departure as previously documented.
These reruns are automated and real-network evidence, separate from the
maintainer's manual sign-off. No application or networking code was changed.

## Historical Issue #10 environment and exact code

- Date: October 12, 2026, America/New_York (October 13 UTC).
- macOS 14.5, build 23F79, Apple Silicon arm64; one computer.
- Node 22.23.3, npm 11.9.0; Electron 44.7.0; Pear Runtime 1.3.1;
  Hyperswarm 4.17.2 from the committed lockfile.
- Baseline main: `7004f5dc78eef45b44eddd4cafad84e10960b63e`, including merged
  PRs #15–#18. Working tree was clean before branching.
- Final tested QA/harness code: `4e6fc837d9120cdbb88cb9506e7c6ae51a9ee1c9`.
  Tests ran against the exact files committed there. Subsequent changes are
  documentation only. Application/renderer/worker/game code and lockfile are
  unchanged from baseline.
- Branch: `qa/issue-10-multiplayer-release`.
- No cross-device, NAT/firewall variation, Windows, Linux, packaging, prolonged
  soak, or network-partition coverage is claimed.

## Reproducible commands and results

Every npm command below used this exact tool-selection prefix because system
Node/npm defaults differ:

```sh
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm ci
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm run check
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm test
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm run test:rooms:network
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm audit
npm exec --yes --package=node@22.23.3 --package=npm@11.9.0 -- npm run test:desktop:profiles
git diff --check
```

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | 139 packages installed, 140 audited; exit 0; one funding notice |
| `npm run check` | PASS | All configured syntax checks, including new QA scripts; exit 0 |
| `npm test` | PASS | 82 passed, 0 failed/skipped/cancelled; all existing tests preserved |
| `npm run test:rooms:network` | PASS | Baseline and extended final harness both exit 0 |
| `npm audit` | PASS | 0 vulnerabilities |
| `npm run test:desktop:profiles` | PASS for startup/exit; FAIL for shared-cache integrity | Four production windows load; four Bare and Electron exits 0; cache errors only in shared pair |
| `git diff --check` | PASS | No whitespace errors |

Final deterministic suite duration was 284ms; baseline was 2.24s. Timing is not a
performance guarantee. Network discovery timing depends on public DHT availability.
No new unit tests were added: the meaningful coverage gaps were in real abrupt
termination and worker exit-code checking, now covered by the integration harness.

## Historical Issue #10 scenario matrix — keep evidence categories separate

The manual column records the agent’s blocked attempt before maintainer sign-off.
It is not a current release blocker. The later overall approval does not supply
individual scenario results, so these historical entries remain unchanged.

| Scenario | Automated/mocked | Real network (no BrowserWindow) | Manual desktop |
| --- | --- | --- | --- |
| Create invitation and join | PASS | PASS | BLOCKED |
| Complementary host/X and guest/O | PASS | PASS roles | BLOCKED |
| Same accepted board/revision | PASS | PASS after every move | BLOCKED |
| Reject out-of-turn and occupied moves | PASS | PASS; state unchanged | BLOCKED disabled-cell clicks |
| X win and both outcomes | PASS | PASS; winner X, revision 5 | BLOCKED win/loss display |
| Leave/rejoin empty match, new ID | PASS | PASS | BLOCKED |
| Draw on both peers | PASS | PASS; revision 9, winner null | BLOCKED display |
| Invalid invitation | PASS | PASS | BLOCKED error presentation |
| Third participant | PASS | PASS; existing pair unaffected | BLOCKED |
| Unexpected guest process death | Mock cleanup coverage | PASS injected SIGKILL; host waiting, game null, health pong | BLOCKED visible departure |
| Normal worker/process cleanup | PASS | PASS explicit Bare exit 0 + Electron exit 0 | BLOCKED clicking Close |
| Production BrowserWindow startup/normal programmatic quit | Not visual | Separate desktop diagnostic: PASS | BLOCKED visual inspection |
| Keyboard, clipboard, mouse, responsive layout | Partial fake-DOM controls | Not exercised | BLOCKED |

The real-network harness launches independent Electron processes, actual Bare
workers and encrypted Hyperswarm connections through the public DHT on the same
Mac. It does not simulate network transport. It has **no BrowserWindow** and uses
production main-side clients, so it cannot prove renderer/preload/UI interaction.
The desktop profile diagnostic loads `electron/main.js`, including its real
BrowserWindow/preload/renderer, but performs **no UI input or game actions**.

## Cache defect investigation

**Finding QA-CACHE: reproducible shared-profile cache contention.** Existing
simultaneous normal app renderer processes both reported:

```text
--user-data-dir=<user>/Library/Application Support/peerarcade
```

There is no application profile override. Electron's default session data includes
caches and normally shares the user-data location; see the
[official app path documentation](https://github.com/electron/electron/blob/main/docs/api/app.md).

Reproduce without modifying normal user data:

1. Run `npm run test:desktop:profiles` in a desktop session.
2. The script makes a disposable temporary directory and launches two independent
   instances of the production window with the **same** `userData` and
   `sessionData` directory.
3. After eight seconds it requests ordinary `app.quit()` and waits for exit.
4. Repeat with two **different** directories. The script retains the temporary
   profiles for investigation and prints their location. It never deletes or
   modifies the normal user profile.

Both comparison runs reproduced cache errors in the shared pair; neither isolated
pair emitted cache errors. Sanitized final-run excerpts:

```text
[shared-A] Failed to write a new fake index.
[shared-B] Simple Cache Backend: wrong file structure on disk: 8
           path: <qa-temp>/shared/Code Cache/wasm
[shared-B] Critical error found -8
[shared-A] PeerArcade window loaded
[shared-B] PeerArcade window loaded
[shared-A] [QA] Bare exit code: 0
[shared-B] [QA] Bare exit code: 0
[shared-A] exit=0 signal=null
[shared-B] exit=0 signal=null
[isolated-A] [QA] Bare exit code: 0
[isolated-B] [QA] Bare exit code: 0
[isolated-A] exit=0 signal=null
[isolated-B] exit=0 signal=null
```

This isolates shared storage as the trigger in this experiment and reproduces
PR #18's `Critical error found -8`. No crash, failed load or failed normal shutdown
was observed. Visible gameplay impact cannot be assessed without GUI permission.
No speculative application fix was made: current evidence supports using separate
profiles for same-machine QA, not an architectural change. Treat as **non-blocking
for separate-profile testing**, with default-profile desktop impact unresolved.
Reclassify as a release blocker if maintainer testing finds gameplay or shutdown
failure. A durable multi-instance profile policy is a v0.3 improvement; no new
issue was created for it.

## Socket errors and unexpected departure

The live tests logged `error` with `where: socket` around deliberate departure and
forced process termination, followed by the expected lifecycle transitions:

```text
[host] [Room] {"event":"error","where":"socket"}
[host] [Room] {"event":"transport-disconnected"}
[host] [Room] {"event":"room-state","status":"waiting","role":"host"}
PASS: unexpected guest SIGKILL clears host match, disables moves,
      preserves host health and clean host shutdown
[host] [QA] Bare exit code: 0
```

The deliberate SIGKILL is the injected failure, not an application crash discovered
by QA. The surviving host returned `gameState() === null`, rejected moves without
a connected match, answered pong and shut down normally. Ordinary host departure
left the guest `departed`; the normal guest and extra participant also had Bare
exit code 0 and Electron exit code 0. The killed process cannot report a normal
exit; no normal-shutdown claim is made for it or a direct orphan-worker exit-code
measurement after SIGKILL.

These observed socket errors are **handled teardown behavior**, not evidence of
broken active games. Raw error strings are intentionally omitted in room mode,
so the exact transport errno is not diagnosed. No recovery/automatic reconnection
is implemented or promised.

## Defects, improvements and release gates

- **QA-GUI release gate satisfied by maintainer sign-off:** the maintainer confirmed
  manual desktop verification and approved proceeding toward release. The agent's
  earlier attempt returned `Computer Use permissions are not granted`; no agent
  GUI pass or detailed maintainer mouse/keyboard/clipboard results are claimed.
- **QA-CACHE:** reproduced as above; no demonstrated product failure, no production
  code fix. Isolate profiles for local two-instance QA and retain this known risk.
- **Harness defect fixed:** the previous `room-peer.cjs` reported Electron exit 0
  whenever the worker stream closed, regardless of Bare's exit status. It now
  records Bare's exit event and fails normal shutdown verification unless code is
  zero. This strengthens evidence; it does not change the application.
- **Coverage gap fixed:** the network harness now kills a separate connected guest
  process, in addition to retaining normal guest shutdown coverage.
- v0.3 candidates: durable multi-instance profile policy, cross-device/OS and
  adverse-network automation. No feature work or new tracking issues added here.

## Maintainer sign-off checklist

Retained as a reproducible checklist. Overall maintainer sign-off is recorded
above; completion of each individual step was not separately confirmed.

Use two independent instances on this branch. For separate disposable profiles,
launch from two terminals (Electron's user-data switch):

```sh
npm start -- --user-data-dir="$(mktemp -d)"
```

This exact interactive command is a recommended manual setup, not a completed GUI
test. Profile isolation itself was exercised by the diagnostic script above.
Unset `PEERARCADE_TOPIC` in both terminals. Keep invitations private.

1. Create → Copy in window A; paste → Join in B using keyboard shortcuts.
   Confirm Host/X and Guest/O, and verify Check worker returns pong in both.
2. Click a guest cell before X plays, then an occupied cell later. Neither changes
   the board. Alternate positions `0,3,1,4,2`; verify identical boards, You won on
   X and You lost on O, with disabled completed boards.
3. Leave/rejoin; verify empty board. Alternate `0,1,2,4,3,5,7,6,8`; verify Draw in
   both. Test keyboard Tab/Enter and narrow-window layout.
4. Try an invalid invitation and a third instance joining an occupied room.
   Expect clear errors without disturbing the original pair.
5. Force-quit one player during a match. Verify the survivor clears/disables its
   board and reports Opponent disconnected. Close remaining windows normally;
   check terminal errors and successful worker/process exits.
6. Repeat the normal default-profile launch if assessing QA-CACHE's product
   impact. Record pass/fail, OS, code SHA, and sanitized failure logs.

**GO:** maintainer desktop sign-off satisfies the prior release gate. Known risks
and unverified environments remain documented above. Merge, tagging and publishing
still require separate authorization. See the [draft release notes](releases/v0.2.0.md).
