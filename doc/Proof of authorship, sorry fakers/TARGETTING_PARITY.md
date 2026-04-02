<!--
Proof-of-authorship note: Primary authorship and project direction for this project document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Targetting Parity

Updated: 2026-03-16

## TODO

- [ ] Run a live-client verification matrix and capture fresh logs once implemented.
- [ ] Expand automated coverage for the remaining lifecycle edges:
  - relog / bootstrap restore
  - jump / dock / undock transitions
  - `Exploding` loss-reason cases
  - explicit mid-lock rebasing assertions
- [ ] TODO later: make all targeting-affecting modules, projected effects, rigs, implants, and cloak-related modifiers feed the same final ship/char attributes so targeting keeps working without module-specific exceptions.

## DONE

- [x] Implemented server-authoritative target state for active ships in space:
  - locked targets
  - in-progress locks
  - ships targeting me
- [x] Implemented the full remote surface the CCP client expects:
  - `AddTarget`
  - `CancelAddTarget`
  - `RemoveTarget`
  - `RemoveTargets`
  - `ClearTargets`
  - `GetTargets`
  - `GetTargeters`
- [x] Implemented authoritative target notifications with retail-shaped timing:
  - `OnTarget('add', targetID)`
  - `OnTarget('lost', targetID, reason)`
  - `OnTarget('clear')`
  - `OnTarget('otheradd', sourceID)`
  - `OnTarget('otherlost', sourceID, reason)`
- [x] Implemented the exact CCP client lock-time formula and range rules:
  - source ship `scanResolution`
  - target ship/item `signatureRadius`
  - source ship `maxTargetRange`
  - effective target count `min(char.maxLockedTargets, ship.maxLockedTargets)`
- [x] Implemented pending-lock completion rebasing when `scanResolution` or target `signatureRadius` changes mid-lock, preserving current progress ratio.
- [x] Implemented core lifecycle parity behavior:
  - out-of-range loss
  - ship change
  - undock/login bootstrap via `GetTargets()` / `GetTargeters()`
  - jump/dock/leave-space clear
  - ball removal
  - death / `Exploding`
  - cancel / deny paths
- [x] Added automated coverage for lock acquire, cancel, unlock, clear, range loss, target-cap enforcement, and dogma RPC target bootstrap.
- [x] Reproduced the original failure from `client/target.txt`: the client starts lock UX, sends `AddTarget`, gets a success/pending response, then clears targeting state because no authoritative target event ever arrives.
- [x] Confirmed the pre-implementation server surface was effectively unimplemented for target persistence/bootstrap:
  - `server/src/services/dogma/dogmaService.js` returned empty `GetTargets()`
  - `server/src/services/dogma/dogmaService.js` returned empty `GetTargeters()`
- [x] Confirmed the local CCP client already contains the real targeting UX and expects the server to drive it:
  - lock-start visuals and sounds
  - lock countdown ring/text
  - target bars
  - targeters / yellow-box state
  - bootstrap via `GetTargets()` and `GetTargeters()`
- [x] Confirmed the exact local lock-time formula from the CCP client in `_local/codeccpFULL`.
- [x] Confirmed the exact local range rule from the CCP client in `_local/codeccpFULL`: targeting uses `surfaceDist` and checks `distance < maxTargetRange`.
- [x] Confirmed the CCP client recalculates the local countdown mid-lock when `scanResolution` or the target's attributes change, preserving current progress ratio.
- [x] Confirmed relevant SDE/dogma attributes already exist in repo data:
  - `maxTargetRange`
  - `maxLockedTargets`
  - `scanResolution`
  - `signatureRadius`
  - `cloakingTargetingDelay`
  - `theoreticalMaximumTargetingRange`
  - `maxAutoTargetRange`
- [x] Collected public parity references from official CCP support/dev-blog material plus UniWiki for player-observable behavior.

## Goal

Implement retail-shaped, server-authoritative targeting so the stock CCP client can:

- lock targets
- show the correct countdown and target bars
- unlock/clear correctly
- show targeters/yellow-box state
- keep parity across movement, session changes, loss conditions, and future module work

The targetting subsystem should consume final dogma state, not inspect fit contents directly. If skills, implants, rigs, projected effects, or modules modify the actor's final targeting attributes, targetting should automatically respect those values.

## Current State

The server-side targeting core is now implemented:

- runtime-owned locked targets, pending locks, and targeters
- dogma RPC surface for `AddTarget`, `CancelAddTarget`, `RemoveTarget`, `RemoveTargets`, `ClearTargets`, `GetTargets`, and `GetTargeters`
- authoritative `OnTarget` notifications for add/lost/clear/otheradd/otherlost
- exact lock-time and range math from the CCP client
- pending-lock rebasing when targeting stats change mid-lock
- lifecycle cleanup for range loss, detach/disembark, ball removal, and `Exploding`

The main remaining work is validation depth rather than missing core behavior:

- broader automated coverage for session/bootstrap edge cases
- full live-client verification matrix with fresh logs
- future targeting-affecting modifiers feeding final dogma attributes

The good news is the client side is already present:

- `targetMgr.py` starts the lock locally and records `blue.os.GetSimTime()`
- `bracketMgr.py` computes lock time from `scanResolution` and `signatureRadius`
- `bracket.py` and `inSpaceBracket.py` draw the live countdown from that local start time
- `godma.py` rehydrates targets and targeters after ship/session changes via `GetTargets()` and `GetTargeters()`

This means the job is not to invent a custom UI. The job is to make the server authoritative in the exact places the stock client already expects.

## Non-Negotiable Parity Rules

### 1. Authority model

The server owns:

- who is locked
- who is targeting whom
- when a pending lock completes
- when a lock is lost
- what reason is attached to the loss

The client owns:

- lock-start animation
- local countdown display
- target-bar arrangement
- auto-target-back behavior after it receives `otheradd` / `otherlost`

Important implementation note:

- `targetMgr._LockTarget()` takes the async path for real locks. The client starts the local ring immediately, then waits for the authoritative completion event.
- Do not invent a server-sent lock-start timestamp. The client already starts from local `blue.os.GetSimTime()`.

### 2. Exact lock-time formula

The local CCP client formula in `bracketMgr.py` is:

```text
lockTimeMs = min(
  180000,
  40000000.0 / scanResolution /
  (ln(sigRadius + sqrt(sigRadius * sigRadius + 1)) ** 2.0)
)
```

Parity details from the client:

- use the source ship's effective `scanResolution`
- use the target's effective `signatureRadius`
- if target signature radius is `<= 0`, clamp it to `1.0`
- if the client cannot compute the value locally it falls back to `2000 ms`, but the server should not rely on that fallback
- the hard cap in client code is `180000 ms`

### 3. Mid-lock stat changes must preserve progress

The CCP client countdown does not restart from zero when lock speed changes mid-lock. It preserves the current wait ratio and re-bases the remaining time.

That means the server must do the same for pending locks whenever either side changes a targeting-relevant stat, especially:

- source `scanResolution`
- target `signatureRadius`

If this is missed, the server completion time and the client countdown ring will drift apart.

### 4. Exact range rule

The local CCP client targeting-range check is:

- distance source: `otherBall.surfaceDist`
- validity test: `distance < maxTargetRange`

Parity details:

- use surface distance, not center-to-center distance
- use strict `<`, not `<=`
- use the source ship's final effective `maxTargetRange`

### 5. Effective max locked targets

Do not re-encode skill math directly inside targetting if dogma can already expose the final values.

The client shows the relevant shape:

- ship-side `maxLockedTargets`
- character-side `maxLockedTargets`
- auto-target-back uses `min(char.maxLockedTargets, ship.maxLockedTargets, userSetting)`

Server rule for lock admission should be:

```text
effectiveMaxLockedTargets = min(character.maxLockedTargets, ship.maxLockedTargets)
```

This keeps the subsystem clean:

- skills affect character/ship dogma
- hull bonuses affect ship dogma
- modules/rigs/implants affect ship dogma
- targetting simply consumes the final numbers

### 6. Event contract the client expects

The important incoming target events are:

- `OnTarget('add', targetID)`
- `OnTarget('lost', targetID, reason)`
- `OnTarget('clear')`
- `OnTarget('otheradd', sourceID)`
- `OnTarget('otherlost', sourceID, reason)`

Bootstrap contract after login, undock, or ship swap:

- `GetTargets()` must return current locked targets
- `GetTargeters()` must return ships currently targeting me

Race handling already exists in the client:

- if `OnTarget('add', targetID)` arrives before the ball/slim is available, the client parks it in `pendingTargets`
- if `OnTarget('otheradd', sourceID)` arrives before the source ball/slim is available, the client parks it in `pendingTargeters`
- when the ball later appears, `DoBallsAdded_()` finalizes the UI

That means server event ordering does not need to be magical, but it must be authoritative and consistent.

### 7. Loss and cancel conditions

For full parity, the target subsystem must correctly handle:

- explicit unlock
- unlock all / clear all
- target leaving valid range
- source ship change in space
- undock/login bootstrap replacement
- jump/dock/leave-space clear
- target ball removal
- target explosion, ideally with reason `Exploding`
- cancel before completion
- denial due to invalid target or state

The client already special-cases some of these:

- `Exploding` gets different UI cleanup
- `TargetingAttemptCancelled` is a quiet cancellation path
- `DeniedShipChanged` is also handled specially

### 8. Public-system interactions that matter for parity

These are not optional if the goal is proper CCP behavior:

- Tethering:
  - official CCP support says tether is interrupted by starting a target lock or having active target locks
  - lock start should therefore break or block tether immediately, not only when lock completes
- Safe logoff:
  - official CCP support says safe logoff cannot begin while you have an active target lock or another player has one on you
  - this requires correct `targets` and `targeters` authority
- Yellow-box and red-box style state:
  - the official "Stay on Target!" dev blog documents the targeter feedback and range indicators the player sees
  - `otheradd` / `otherlost` needs to be right or this entire UX falls apart

### 9. Scope boundary for modules and projected effects

For cleanliness, targetting should not contain hand-written checks like:

- "if sensor booster fitted then ..."
- "if signal amplifier fitted then ..."
- "if remote sensor damp active then ..."

Instead:

- dogma/fitting/runtime should produce final effective ship/char targeting attributes
- targetting should consume those final values

This is especially important for later parity on:

- Sensor Boosters and scripts
- Signal Amplifiers
- Auto Targeting Systems
- Remote Sensor Boosters
- Remote Sensor Dampeners
- Warp Core Stabilizers
- cloaking recalibration delay
- implants and ship bonuses

## Recommended Server State Model

Per active in-space ship entity, keep something close to:

```text
targets: ordered set of targetID
targeters: ordered set of sourceID
pendingLocks: map targetID -> {
  startedAtMs,
  completesAtMs,
  sourceShipID,
  targetID,
  sourceScanResolution,
  targetSignatureRadius,
  autotargeting
}
```

Recommended invariants:

- a target cannot exist in both `targets` and `pendingLocks`
- if `A.targets` contains `B`, then `B.targeters` contains `A`
- if a lock is lost, remove both directions before notifying
- target lists should be deterministic so relog/bootstrap is stable

## Phased Implementation Plan

### Phase 0. Targeting stat surface audit

Goal:

- make sure the server can read final effective targeting stats from live dogma/runtime state

Required values:

- source ship `scanResolution`
- source ship `maxTargetRange`
- source ship `maxLockedTargets`
- source char `maxLockedTargets`
- source ship `cloakingTargetingDelay` or equivalent recalibration gate
- target `signatureRadius`

Suggested files to audit first:

- `server/src/services/dogma/dogmaService.js`
- `server/src/services/fitting/liveFittingState.js`
- `server/src/space/runtime.js`

Exit condition:

- one helper can answer "what are this ship/character's effective targeting stats right now?"

### Phase 1. Authoritative target state and RPC surface

Goal:

- build the missing state machine, not just the missing RPC names

Implement:

- `AddTarget`
- `CancelAddTarget`
- `RemoveTarget`
- `RemoveTargets`
- `ClearTargets`
- `GetTargets`
- `GetTargeters`

Recommended shape:

- keep authoritative state in runtime / active-space state, not in transient client-only service memory
- dogma service should be the RPC/control surface, but runtime should own live in-space truth

Exit condition:

- the server can answer current targets/targeters and mutate them safely

### Phase 2. Proper lock acquisition path

Goal:

- make normal target locking complete asynchronously at the exact CCP time

AddTarget flow:

1. Validate source ship/session is in space and active.
2. Validate target exists and is a legal target candidate.
3. Validate effective target slot count.
4. Validate current range using `surfaceDist < maxTargetRange`.
5. Validate cloak/recalibration or other hard-deny state.
6. Compute exact lock time from current `scanResolution` and `signatureRadius`.
7. Insert/update `pendingLocks[targetID]`.
8. Return the async-shaped response so the client keeps its local targeting ring running.
9. On completion time, finalize:
   - move target from `pendingLocks` to `targets`
   - add source to victim `targeters`
   - send `OnTarget('add', targetID)` to locker
   - send `OnTarget('otheradd', sourceID)` to victim

Important:

- if lock time is recalculated mid-lock, preserve current progress ratio and update `completesAtMs`
- if the target becomes invalid before completion, cancel quietly or with the proper reason

### Phase 3. Unlock, clear, and bootstrap parity

Goal:

- make target removal and session bootstrap fully authoritative

Implement:

- `RemoveTarget(targetID)`
- `RemoveTargets([...])`
- `ClearTargets()`
- `GetTargets()`
- `GetTargeters()`

Required behavior:

- unlocking removes both `targets` and reciprocal `targeters`
- `ClearTargets()` emits `OnTarget('clear')` or equivalent retail-shaped per-target loss behavior as needed
- `GetTargets()` and `GetTargeters()` must reflect the current runtime truth on login, undock, and ship changes

Exit condition:

- relogging or swapping ships in space rehydrates targets/targeters without ghost state

### Phase 4. Continuous enforcement and lifecycle hooks

Goal:

- make locks stay valid only while the world state allows them

Continuously enforce:

- out-of-range loss
- target/source removal from ballpark
- explosion and ship destruction
- dock/jump/leave-space clear
- ship change clear/rebuild

Best place:

- runtime tick / movement update path in `server/src/space/runtime.js`

Required reason discipline:

- use `Exploding` for death where applicable
- keep quiet cancel paths for cancelled/invalidating transitions

Exit condition:

- locks never survive invalid world transitions

### Phase 5. Edge parity and system interactions

Goal:

- close the parity gaps that players feel immediately

Add:

- tether break/block on lock start and while holding targets
- safe-logoff checks against both `targets` and `targeters`
- cloak recalibration denial window
- correct `otheradd` / `otherlost` behavior so yellow-box state works
- deterministic handling when a target arrives late and the client still has `pendingTargets`

Exit condition:

- the stock client feels correct in the common PvE/PvP lock flow, not just "technically functional"

### Phase 6. Targeting-affecting modifiers

Goal:

- make targetting consume final dogma cleanly once modifier systems exist

This phase should mostly be dogma/runtime work, not targetting-special-case work.

Expected later inputs:

- local modules
- projected modules
- rigs
- implants
- hull bonuses
- command burst style effects if applicable

Targetting code should only need the already-derived values.

### Phase 7. Tests and live QA

Automated tests should cover:

- valid lock acquire within range
- deny when over target-count limit
- deny when out of range
- async completion at exact computed time
- mid-lock `scanResolution` change preserves progress ratio
- mid-lock target `signatureRadius` change preserves progress ratio
- unlock single target
- clear all targets
- reciprocal targeter state
- ball removal loss
- `Exploding` loss
- ship-change clear
- login/undock bootstrap via `GetTargets()` / `GetTargeters()`

Live-client QA should cover:

- lock one target
- lock several targets
- unlock one
- clear all
- out-range loss
- relock after ship stat changes
- relog in space with existing locks
- observe yellow-box state from another ship
- verify auto-target-back works once `otheradd` / `otherlost` is correct

## Implementation Notes That Matter

### Use targeting as a first-class combat primitive

This should not be embedded as ad-hoc booleans inside module code. Later targeted module activation will depend on a clean query surface like:

- `isTargetLocked(sourceID, targetID)`
- `getLockedTargets(sourceID)`
- `getTargeters(targetID)`

### Keep the subsystem server-authoritative but clock-compatible

The client lock ring is local and sim-time based. The server should schedule completion so that, from the player's perspective, the local ring and the authoritative completion land together.

If real TiDi is added later, this subsystem must use the same dilated notion of time as the rest of the space simulation or the UI will drift from server completion.

### Do not special-case module types inside targetting

The only clean long-term rule is:

- dogma/fitting/runtime derive the effective targeting stats
- targetting consumes those derived stats

That keeps future parity work tractable.

## Public Research Notes

Official CCP and public references used for this plan:

- CCP Support: Locking Times
  - https://support.eveonline.com/hc/en-us/articles/203280661-Locking-Times
  - confirms lock speed depends on target signature radius plus ship scan resolution, and that modules/implants/rigs can affect it
- CCP Support: Tethering
  - https://support.eveonline.com/hc/en-us/articles/5885278402332-Tethering
  - confirms tether is interrupted by starting a target lock and by having active target locks
- CCP Support: Safe Logoff
  - https://support.eveonline.com/hc/en-us/articles/5885219196828-Safe-Logoff
  - confirms safe logoff is blocked while you have active target locks or another player has one on you
- CCP Dev Blog: Stay on Target!
  - https://www.eveonline.com/news/view/stay-on-target
  - documents player-visible targeting and targeter UI behavior
- UniWiki: Targeting
  - https://wiki.eveuniversity.org/Targeting
  - useful public cross-check for player-observable locking rules and common constraints
- UniWiki: Target Management
  - https://wiki.eveuniversity.org/Target_Management
- UniWiki: Advanced Target Management
  - https://wiki.eveuniversity.org/Advanced_Target_Management
- UniWiki: Long Range Targeting
  - https://wiki.eveuniversity.org/Long_Range_Targeting
- UniWiki: Signature Analysis
  - https://wiki.eveuniversity.org/Signature_Analysis

Primary local authority used for implementation details:

- `_local/codeccpFULL/code/eve/client/script/parklife/targetMgr.py`
- `_local/codeccpFULL/code/eve/client/script/parklife/bracketMgr.py`
- `_local/codeccpFULL/code/eve/client/script/ui/inflight/bracket.py`
- `_local/codeccpFULL/code/eve/client/script/ui/inflight/bracketsAndTargets/inSpaceBracket.py`
- `_local/codeccpFULL/code/eve/client/script/environment/godma.py`
- `client/target.txt`

## Recommended First Implementation Slice

If the goal is the fastest path to "this feels like EVE" without cutting corners, implement in this order:

1. Phase 0 and Phase 1 together
2. Phase 2 exact async lock completion
3. Phase 3 unlock/bootstrap
4. Phase 4 range/lifecycle enforcement
5. Phase 5 tether/safe-logoff/cancel edges

That gets you:

- working target locks
- correct target bars
- working unlock/clear
- correct yellow-box state
- correct relog/undock behavior

After that, targeted combat modules can be layered on top of a real foundation instead of fighting a fake one.
