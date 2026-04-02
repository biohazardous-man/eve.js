<!--
Proof-of-authorship note: Primary authorship and project direction for this project document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Missiles: How They Work In The Client And What Parity Actually Requires

**Author**: John Elysian (with Codex assistance)
**Date**: 2026-03-31
**Status**: Working parity behavior identified and implemented

---

## Purpose

This document explains:

- what layers are involved when a missile is fired
- what the EVE client does at each stage
- why short-range missiles and long-range missiles behave differently
- what parity behavior the server must reproduce
- what the real long-range bug was
- why earlier fixes helped but did not solve the core issue

This is meant to be shareable and readable without needing to reconstruct the whole investigation from logs.

---

## The Three Layers

When a missile is fired, there are really three different systems involved:

1. **Destiny ball**
   - The low-level live movement object the client receives through `AddBalls2`.
   - This is the missile "ball" inside Michelle / Destiny.

2. **`spaceObject.Missile` wrapper**
   - The gameplay/space-object layer that reads missile slim data like:
     - `sourceShipID`
     - `launchModules`
     - `typeID`
   - This layer decides whether the shot is short-range or long-range.

3. **Trinity missile graphics**
   - The visual missile / warhead controller in `eveSpaceObject.missile`.
   - This is the thing that launches the visible warhead from the launcher hardpoint and flies it to the target.

The important parity lesson is:

**The visual warhead path is not driven only by the server's hit result. It is driven by what the client thinks the missile ball is doing when `Prepare()` runs.**

---

## Client Stage-By-Stage

## 1. The server sends `AddBalls2`

The client receives a missile through Michelle / Destiny as:

- a live missile ball
- slim data containing missile metadata

For missiles, the important slim fields are:

- `sourceShipID`
- `launchModules`
- `typeID`
- `itemID`

This gives the client:

- the live ball it can query for position, direction, velocity, and max speed
- the source ship it should use for launcher-relative visuals
- the launcher module IDs it should use to find turret sets / firing bones

---

## 2. `spaceObject.Missile.LoadModel()` sets the missile up

Client file:

- `_local/codeCCPFULL/code/eve/client/script/environment/spaceObject/missile.py`

At load time, the client:

- stores `sourceShipID`
- stores `sourceModuleIDList` from `launchModules`
- creates `gfxmissile.MissileGraphics`
- sets the missile model's translation/rotation curves to the missile ball

At this point the client has not yet decided whether this is a short-range instant-style shot or a long-range spread shot.

---

## 3. `Prepare()` decides short-range vs long-range

The key client function is `_GetTimeToTarget()`.

It does this:

- samples the missile ball's **current** position
- samples the target ball's **current** position
- computes surface ETA using `self.maxVelocity`
- if surface ETA is less than `1.6`, sets `doSpread = False`
- otherwise sets `doSpread = True`

This is the critical branch.

### Short-range branch

If `timeToTarget < 1.6`:

- `doSpread = False`
- `Prepare()` immediately calls `DoCollision()`
- `collided` becomes true almost immediately

This means short-range missiles are very forgiving. The client basically treats them like an immediate-hit path.

### Long-range branch

If `timeToTarget >= 1.6`:

- `doSpread = True`
- the client does **not** immediately collide
- instead it starts the long Trinity missile/warhead visual path

That path is much stricter about parity.

---

## 4. What Trinity expects for long-range missiles

Client files:

- `_local/codeCCPFULL/code/eve/client/script/environment/spaceObject/missile.py`
- `tools/ClientCodeGrabber/Latest/eveSpaceObject/missile.py`

For long-range missiles, the client does all of the following:

- sets the **source translation curve** to the source ship ball
- resolves launcher turret sets from `launchModules`
- reads firing-bone / muzzle transforms from the launcher
- computes missile start speed from the **source ship curve**
- starts the Trinity missile model with `Start(..., timeToTarget, doSpread=True)`

This means the long-range visual path assumes:

- the visible warhead launches from the ship / launcher
- the warhead gets a flight timer based on `Prepare()`'s `timeToTarget`
- the Destiny missile ball still represents the real launch frame when `Prepare()` runs

That last point is the one that mattered most.

---

## The Big Difference Between Short And Long Range

### Short range

Short-range missiles work because the client quickly switches into the collision path.

Even if the live missile ball state is a little rough:

- the client calls `DoCollision()` immediately
- `collided = True`
- the later teardown path is usually harmless

So short-range missiles are tolerant.

### Long range

Long-range missiles work only if the client sees the missile ball in the right launch state when `Prepare()` runs.

Why?

Because Trinity is doing a real warhead-flight visual. It launches that warhead from the ship and gives it a timer. If the timer is wrong, the warhead fizzles before reaching the target.

So long-range missiles are not tolerant.

---

## What The Client Was Expecting That We Were Not Doing

The client expected long-range missiles to start as a **parked launch anchor**, not as an already-active missile.

For long-range `doSpread=True` missiles, the correct initial presented state is:

- `velocity = 0`
- `speedFraction = 0`

Why both?

Because those fields mean different things:

- `velocity = 0` says "the missile is not currently moving"
- `speedFraction = 0` says "the missile is not actively under throttle"

We had only fixed the first one for part of the investigation.

That was not enough.

---

## The Real Bug

The failing long-range missiles were being born like this:

- `velocity = 0`
- `speedFraction = 1`

That is contradictory from the client's point of view.

It tells Destiny:

"This missile is currently stationary, but it is also an active full-speed FOLLOW ball."

Because missile agility is tiny, the client effectively treats that as "this missile starts moving immediately."

So by the time `Prepare()` runs:

- the client samples the missile ball from a position already closer to the target
- `_GetTimeToTarget()` returns a shortened timer
- Trinity still launches the visible warhead from the ship / launcher
- the warhead now has too little time to cover the full visual path
- result: **the warhead flies partway, then fizzles in space**

That is why:

- the missile looked like it was going the right way
- damage still applied correctly
- the visual died short only on longer shots

---

## Why The Threshold Was Around 13 km

The break happened at roughly the point where the client switches from:

- short-range `doSpread=False`

to:

- long-range `doSpread=True`

For heavy missiles, that switch is around the `1.6s` surface-ETA threshold.

Below that threshold:

- the client takes the immediate-collision path
- the bug is masked

Above that threshold:

- the client uses the Trinity long-flight path
- the bad launch-state parity becomes visible

That is why the problem was distance-sensitive instead of random.

---

## Why Earlier Fixes Failed

Earlier fixes were aimed at real surrounding problems, but not the final core mismatch.

They improved things like:

- `AddBalls2` stamp safety
- deferred first-acquire launch snapshots
- teardown timing
- delayed release after impact
- removal / explosion-effect behavior

Those were useful and some are still important.

But they were still changing behavior around a missile ball that the client saw as:

- already active
- already accelerating
- already moving into its FOLLOW solve before `Prepare()`

So the long-range timer kept getting poisoned anyway.

In short:

**We were fixing transport and lifecycle issues around a still-wrong local movement state.**

---

## The Working Parity Rule

For the first client acquire of a long-range missile, the server must present:

1. the authored launch snapshot
   - not a later projected live FOLLOW state

2. a Michelle-safe `AddBalls2` stamp
   - inner state stamp aligned with delivery stamp

3. a parked long-range launch state
   - `velocity = 0`
   - `speedFraction = 0`

4. no immediate bootstrap replay that fights the launch snapshot
   - no instant `FollowBall`
   - no instant `SetSpeedFraction`
   - no instant `SetBallVelocity`

5. enough post-impact visual time for the client's collision path to finish

This is the combination that finally made long-range missiles land visually.

---

## What We Implemented

The key working fix was:

- for `doSpread=True` missiles, initial presented state now uses:
  - `velocity = {0, 0, 0}`
  - `speedFraction = 0`

Short-range missiles still keep the old active launch behavior, because they use the immediate-collision path and already worked.

In other words:

- **short range**: active instant-style shot is fine
- **long range**: must bootstrap as a parked launcher-relative visual start

---

## The Best One-Paragraph Shareable Explanation

EVE missiles have two client paths. Short-range missiles use an almost immediate collision path, so they are tolerant of rough live-ball state. Long-range missiles use Trinity's real warhead-flight path, and that path expects the missile ball to still be sitting at the launcher when `Prepare()` runs. We were spawning long-range missiles with zero velocity but still marked as full-throttle FOLLOW balls, so the client shortened the warhead timer before the visual launch even began. The fix was to spawn long-range missiles as a truly parked launch anchor: zero velocity and zero speed fraction.

---

## Current Practical Takeaway

If long-range missiles ever start "flying correctly, then fizzling short" again, check the first `AddBalls2` launch state before anything else.

The first question should be:

- is the client seeing this missile as a parked launch anchor?

If the answer is no, Trinity timing will drift and the visual will fail even if the server-side hit logic is correct.

---

## Reference Files

Client:

- `_local/codeCCPFULL/code/eve/client/script/environment/spaceObject/missile.py`
- `tools/ClientCodeGrabber/Latest/eveSpaceObject/missile.py`

Server:

- `server/src/space/runtime.js`
- `server/src/space/destiny.js`
- `server/src/space/combat/missiles/missileSolver.js`
