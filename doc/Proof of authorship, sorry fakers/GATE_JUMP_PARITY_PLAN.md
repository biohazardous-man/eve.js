<!--
Proof-of-authorship note: Primary authorship and project direction for this planning document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Gate Jump Parity Plan

Updated: 2026-03-15

## TODO

- [ ] Add destination-side observer gate activity / arrival visuals after the functional jump path is stable.
- [ ] Do one live-capture timing pass to tune the final source handoff delay and camera feel against the local CCP client.
- [ ] Decide from live evidence whether gate jumping also needs explicit `effects.GateActivity` and/or `effects.JumpIn` for closer observer parity.

## DONE

- [x] Replace the current instant stargate transfer with a staged source-FX -> handoff -> destination-bootstrap jump flow.
- [x] Emit native source-side gate jump FX so the pilot and source-grid observers see a real stargate jump instead of an immediate teleport.
- [x] Delay source detach / ball-clear until after the jump-out contract has started.
- [x] Replace placeholder destination spawn direction with gate-oriented exit placement derived from the destination gate.
- [x] Tighten stargate validation so the runtime only accepts the real `fromGate -> toGate` jump pair and a 2500 m surface-range jump check.
- [x] Add focused regression coverage for pilot, source observer, and destination observer gate-jump flows.
- [x] Pilot gate jumping now matches the local CCP client contract at the code-path level:
  - `effects.JumpOut`
  - `targetID = sourceGateID`
  - `start = 1`
  - `active = 0`
- [x] `effects.JumpOut` now carries destination-system `graphicInfo` so the V23.02 client subway service can preload and activate the destination scene instead of falling back to `destSystemID = None`.
- [x] Source observers now see the jump FX and then lose the ship through normal source-scene removal.
- [x] Destination observers now acquire the arriving ship through normal runtime visibility on the destination grid.
- [x] Destination initial ballpark now boots immediately after handoff instead of waiting for a later `beyonce` bind, which avoids a long transition-scene stall before `AddBalls2`.
- [x] `CmdStargateJump` already exists and routes through `server/src/services/ship/beyonceService.js`.
- [x] A stargate transition path already exists in `server/src/space/transitions.js`.
- [x] Stargates are re-enabled in the live scene.
- [x] Stargate scene/slim data now includes `activationState`, `poseID`, warning/banner fields, `destinationSystemStatusIcons`, and `dunRotation`.
- [x] Stargate `jumps` data exists for source-to-destination lookup on the client side.
- [x] Dynamic stargate `activationState` updates already travel through `DoDestinyUpdate -> OnSlimItemChange`.
- [x] Initial in-space bootstrap now follows the client split path `AddBalls2 -> SetState -> prime/mode`.
- [x] `OnSpecialFX` payload packing now reserves the full optional tail, which is required before reliable jump FX work.
- [x] The current jump path already performs the basic ship move, session reapply, and destination reattach.

## Goal

Implement retail-style stargate jumping for the current scope:

- pilot sees the native gate jump and transition sequence
- source-grid observers see the ship use the gate and leave their scene
- the ship disappears from source observers at the right point in the jump
- the ship appears on the destination gate grid in the next system
- destination observers acquire the ship through the normal runtime visibility path

Explicitly out of scope for this pass:

- post-jump invulnerability / gate cloak
- gate-lock / restricted-system / jump-queue logic
- non-essential gate presentation parity that is not required to make jumping behave correctly

## Current Findings

### What EvEJS already does

- `jumpSessionViaStargate(...)` in `server/src/space/transitions.js` already validates that the character is in space, resolves source and destination gates, moves the ship item into the destination system, reapplies the character session, and reattaches the session to the destination scene.
- The current runtime already has enough stargate scene/slim data for the client to resolve gate identity, destination info, and baseline controller state.
- The client bootstrap path after a session move is already much closer to CCP parity than earlier builds because the initial ballpark is now split as `AddBalls2 -> SetState -> prime/mode`.
- The current jump path now sends native source-side `effects.JumpOut`, waits briefly before session handoff, and spawns from the destination gate using gate-oriented exit placement instead of the old solar-system-center fallback.

### What still remains after this pass

1. Observer gate-side animation is still the main missing visual.

- The functional jump path is in place now.
- What is still missing is optional gate-side presentation such as `effects.GateActivity`, if live comparison shows the observer-facing gate itself still looks too quiet.

2. Final timing still needs a live comparison pass.

- The current implementation matches the local CCP client code path for `JumpOut`.
- The remaining open question is whether the chosen handoff delay should be nudged after a live side-by-side comparison.

3. Explicit `JumpIn` remains evidence-gated.

- The current pass does not force an explicit `effects.JumpIn`.
- That should stay deferred until live evidence shows the client really expects it for this gate-jump slice instead of only the departure-driven transition plus destination bootstrap.

## What the CCP Client Expects

The local client reference in `_local/codeccpFULL` shows a specific stargate-jump contract:

1. `CmdStargateJump` is called as a session-changing action.

- Client menu and autopilot paths wrap the gate jump in `PerformSessionChange(...)`.

2. The pilot jump presentation is started by `effects.JumpOut`.

- `_local/codeccpFULL/code/eve/client/script/parklife/spaceMgr.py` has dedicated `OnSpecialFX(...)` handling for `effects.JumpOut`.
- `_local/codeccpFULL/code/eve/client/script/environment/effects/Jump.py` starts `JumpTransitionGate` from `JumpOut.Start(...)`.

3. The transition uses the source gate and the gate's destination jump info.

- `JumpTransitionGate.Prepare(...)` pulls `destStargate, destSystem = ...GetInvItem(stargateID).jumps[0]`.
- It then calls `InitializeGateTransition(destSystem, destStargate)` in `_local/codeccpFULL/code/eve/client/script/ui/view/spaceToSpaceTransition.py`.

4. Ball-clear / scene-swap is transition-aware on the client.

- `_local/codeccpFULL/code/eve/client/script/parklife/gameui.py` finalizes the active space-to-space transition on ball clear instead of doing a plain scene teardown.
- That means the server needs to present the jump as a real scene transition, not just a move plus a fresh ballpark.

5. Gate-side activity also exists as a distinct client effect.

- `_local/codeccpFULL/code/eve/client/script/environment/effects/Jump.py` includes `effects.GateActivity`.
- This is useful for observer-facing gate presentation, but it is not the first blocker.

## Public Research Notes

- No newer CCP dev blog was found in this pass that appears to replace the core stargate jump contract described by the current client code.
- The most relevant public references still appear to be:
  - Session-change behavior and timers
  - Stargate hologram / gate presentation changes
  - jump tunnel / visual-overhaul notes

Useful public references from this research pass:

- `https://support.eveonline.com/hc/en-us/articles/205294121-Session-Change`
- `https://support.eveonline.com/hc/en-us/articles/360001641900-Stargate-Holograms`
- `https://www.eveonline.com/news/view/clear-vision-update`
- `https://www.eveonline.com/news/view/patch-notes-for-version-18-05`
- `https://www.eveonline.com/news/view/patch-notes-for-yc119.1-release`

## Implementation Plan

### Functionality Phases

These phases are the minimum work required to make gate jumping behave correctly.

#### Phase 1 - Replace Teleport Flow With A Real Jump Timeline

Status:

- done in this pass

Primary goal:

- stop detaching the session immediately on `CmdStargateJump`

Work:

- keep `jumpSessionViaStargate(...)` as the single authoritative jump entry point
- add an explicit short-lived gate-jump state on the session or ship entity
- split jump handling into:
  - validate
  - emit source jump FX
  - wait for the handoff point
  - detach from source scene
  - move ship item and character session
  - attach to destination scene
  - bootstrap destination ballpark
- keep the existing transition guard logic so duplicate jump commands still collapse cleanly

Exit criteria:

- the jump no longer behaves like an immediate detach + teleport

#### Phase 2 - Source-Side Departure FX For Pilot And Observers

Status:

- done in this pass

Primary goal:

- make the source scene show a native gate jump before the session handoff happens

Work:

- emit `OnSpecialFX(..., guid='effects.JumpOut', targetID=sourceGateID, start=1, active=0, ...)` from the source scene
- send that FX on the actual stargate jump path, not as a debug/test-only effect
- keep the jumping ship in the source scene long enough for the client to start `JumpTransitionGate`
- only detach the source session after the jump-out contract has clearly begun

Notes:

- the exact payload shape and timing should be verified from live client capture before being declared final
- the pilot tunnel/camera transition should come from this path, not from a synthetic destination-side trick

Exit criteria:

- pilot sees a real gate transition start
- source-grid observers see the jump happen before the ship leaves the grid

#### Phase 3 - Destination Handoff And Correct Gate Exit Placement

Status:

- done in this pass

Primary goal:

- arrive in the destination system from the destination gate, not from a placeholder vector

Work:

- replace `buildGateSpawnState(...)` with gate-oriented exit placement
- derive exit direction from destination gate authored/resolved rotation data
- place the ship at a stable offset from the destination gate along that gate forward axis
- spawn the ship in a clean post-jump state:
  - on the right grid
  - stopped or near-stopped as appropriate for current scope
  - facing consistently with the destination gate exit direction
- continue using the existing destination bootstrap path:
  - session reapply
  - `awaitBeyonceBoundBallpark`
  - split `AddBalls2 -> SetState -> prime/mode`

Exit criteria:

- the pilot appears on the correct destination gate grid
- destination arrival no longer depends on the solar-system-center fallback direction

#### Phase 4 - Observer Parity Across Both Systems

Status:

- done in this pass

Primary goal:

- make source and destination observers see the jump in the right order

Work:

- source observers:
  - see the ship remain present through departure FX start
  - then lose the ship when the server executes the handoff
- destination observers:
  - acquire the arriving ship through normal runtime visibility
  - do not require a special-case fake observer teleport path
- verify that source observers do not reacquire the departed ship after the transfer
- verify that destination observers only see the ship if it is really on their bubble/grid

Exit criteria:

- source observers see departure
- destination observers see arrival
- the ship does not visibly exist in both systems at once

#### Phase 5 - Validation, Instrumentation, And Regression Tests

Status:

- done in this pass

Primary goal:

- make the jump path stable enough to keep iterating without regressions

Work:

- add a focused internal self-test for stargate jump parity
- add debug logging for:
  - jump command receipt
  - source FX send
  - detach time
  - destination attach time
  - initial ballpark send
  - observer add/remove events in both systems
- validate at least one well-known gate pair repeatedly, such as Jita <-> New Caldari
- capture pilot and observer logs to lock the final timing

Exit criteria:

- we can prove that the pilot, source observer, and destination observer flows all stay correct

### Polish Phases

These are important for fidelity, but they should come after the functional path above is stable.

#### Polish 1 - Gate Activity And Arrival Presentation

Work:

- add gate-side activity FX where the evidence shows the client expects them
- use `effects.GateActivity` for observer-facing gate activation / arrival presentation if it improves parity
- only add explicit `JumpIn` behavior if live capture shows the retail path really uses it for this gate-jump slice

Why this is polish:

- the pilot transition and cross-system move can work before every gate-side observer visual is perfectly tuned

#### Polish 2 - Timing And Visual Sequence Tuning

Work:

- tune the delay between source `JumpOut` emission and actual session handoff
- tune source disappearance timing for better observer parity
- tune destination arrival timing relative to scene bootstrap
- compare against live retail captures and adjust until the sequence feels native

Why this is polish:

- the jump can already be functionally correct before the timing is pixel-perfect

#### Polish 3 - Remaining Gate Presentation Parity

Work:

- finish the remaining non-essential gate controller/banner/status fields
- refine any remaining gate orientation edge cases that show up on specific hulls
- revisit dynamic status icons, owner/banner state, and other gate presentation details that are not required for the jump transport itself

Why this is polish:

- those items improve fidelity, but they are not the core blocker for source departure, cross-system movement, or destination arrival

## Verification Completed

- `node --check server/src/space/runtime.js`
- `node --check server/src/space/transitions.js`
- `node --check scripts/internal/selftest_stargate_jump_parity.js`
- `node scripts/internal/selftest_stargate_jump_parity.js`
- `node scripts/internal/selftest_stargate_scene_parity.js`
- `node scripts/internal/selftest_stargate_activation_state_dynamic.js`
- `node scripts/internal/selftest_michelle_slim_item_change_transport.js`

## Recommended Build Order

If this work is done incrementally, the cleanest order is:

1. Phase 1 - staged jump timeline
2. Phase 2 - source-side `JumpOut`
3. Phase 3 - destination gate-oriented spawn
4. Phase 4 - observer parity across both systems
5. Phase 5 - tests and instrumentation
6. Polish phases after the above are stable

## Practical Definition Of "Good Enough" For This Scope

For this pass, gate jumping should be considered successful when all of the following are true:

- the pilot uses a gate and gets the native gate transition instead of an instant teleport
- source observers visibly see the ship jump and then lose it
- the ship arrives on the far gate grid in the next system
- destination observers see the ship appear through the normal runtime visibility path
- no gate cloak / invulnerability support is required yet
- no gate-lock / restricted-system behavior is required yet
