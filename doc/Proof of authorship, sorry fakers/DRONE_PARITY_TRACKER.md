<!--
Proof-of-authorship note: Primary authorship and project direction for this tracker document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Drone And Fighter 1:1 Parity Tracker

Recreated: 2026-03-29

This file was rebuilt after the previous tracker became corrupted. Everything below is based on surviving code, surviving tests, surviving client traces, and local `_local/codeccpfull` research. Anything not re-proven stays TODO.

Current conservative parity estimate from surviving verified code/tests only: 81%

Scope: all drones and fighters.
Explicit exclusions for this tracker: drone/fighter EWAR families, salvage drones, fleet assist, fleet guard.

Authority order for every mechanic and payload:
1. `_local/codeccpfull`
2. live client traces in `client/*.txt`
3. local official static data in this workspace
4. public data only when 1-3 do not exist

Rule: client-visible behavior and payload shape are authority. We do not invent mechanics. If the client expects a specific tuple, rowset, notification, timer, or failure label, server parity means matching that exactly.

## TODO

- [ ] Lock exact localized retail `UserError` tuples and argument dicts for drone launch, reconnect, scoop, return-limit, and launch-bandwidth failures. Current surviving code still uses fallback text in some cases.
- [ ] Lock exact localized retail `UserError` tuples and argument dicts for fighter launch, recall, abandon, scoop, and ability activation/deactivation failures. Some surviving paths are correct, but not every failure label is proven against CCP data yet.
- [ ] Finish dock, undock, reconnect, and the remaining session-recovery parity for launched drones and fighters. Disconnect/logoff nearby-recovery, jump-style detach, and same-scene ship destruction are covered; the remaining lifecycle cases still need full client-authority verification.
- [ ] Lock exact fighter tube state timing against CCP behavior for `LAUNCHING`, `RECALLING`, `LANDING`, `READY`, and `REFUELLING`. Current surviving code covers real launch/recall, but not every timed presentation state is proven.
- [ ] Finish the remaining non-EWAR fighter family coverage and exact family-specific activation/deactivation failure semantics that are not yet explicitly proven by surviving tests.
- [ ] Re-audit killmail attribution and final blow ownership across every surviving drone and fighter combat family to ensure no family silently diverges.
- [ ] Re-audit bracket, overview, and grid presentation for large-scale churn: abandoned drones, reconnect, destruction, launch/recall storms, and TiDi-heavy observer cases with thousands of drones/fighters.
- [ ] Add explicit soak/perf verification for thousands of drones and fighters in one scene so parity claims include scale, not just correctness at small counts.
- [ ] Re-run fresh client trace validation for every rebuilt slice after corruption recovery and only move items from TODO to DONE when the live client and `_local/codeccpfull` agree.

## DONE

- [X] Re-established `_local/codeccpfull` as the top authority for drone/fighter UI, menu, HUD, and payload contracts.
- [X] Re-established client trace files under `client/*.txt` as the second authority for real packet behavior and client failure analysis.
- [X] Moved drone runtime behavior out of `runtime.js` hot path bloat and kept the main implementation in `server/src/services/drone/droneRuntime.js`.
- [X] Moved fighter runtime behavior out of `runtime.js` hot path bloat and kept the main implementation in `server/src/services/fighter/fighterRuntime.js`.
- [X] Surviving drone launch path creates real in-space drone entities, sets default orbit around the controlling ship, and emits live `droneState` rows through Destiny.
- [X] Surviving drone return-home path drives drones back into idle orbit around the controlling ship.
- [X] Surviving drone return-to-bay path recalls drones into `flagDroneBay`, removes their in-space balls, and emits the client cleanup state.
- [X] Surviving drone abandon path clears control without deleting the in-space drone and drops it out of the active `droneState` rows.
- [X] Surviving drone reconnect path restores control of valid disconnected owned drones.
- [X] Surviving drone scoop path allows foreign abandoned drone recovery and reparents the recovered inventory item into the scooping pilot's drone bay.
- [X] Surviving drone launch/return commands now return marshal-safe dict payloads instead of collapsing to `retval=None`.
- [X] Surviving `ship.LaunchDrones(...)` now returns a marshal-safe keyed launch-result dict for CCP `eveMisc.LaunchFromShip`, fixing the `launch.txt` `TypeError: 'NoneType' object is not iterable` client crash.
- [X] Surviving bound-ship follow-up `LaunchDrones(...)` calls now resolve through the packet dispatcher instead of collapsing to `retval=None`, matching the second CCP `LaunchFromShip` call path seen in `client/drone2.txt`.
- [X] Surviving drone command bind replies for `CmdReturnHome` and `CmdReturnBay` are marshal-safe on the wire for CCP `HandleMultipleCallError`.
- [X] Surviving split-created drone itemIDs now get a post-launch `OnDroneStateChange` replay after the initial in-space slim exists, repairing the surviving `client/drone2.txt` tooltip/dogma race where launched split drones could appear in space but still miss `GetDogmaItem(...)`.
- [X] Surviving drone batch command normalization handles client-style collections so engage/return commands apply to all selected drones instead of only one.
- [X] Surviving drone combat runtime supports `CmdEngage(...)` with live target pursuit, real damage application, client state updates, and observer-visible combat FX under TiDi.
- [X] Surviving drone mining runtime supports `CmdMineRepeatedly(...)` for ice drones, standard mining drones, and excavators, with delivery into the correct ship hold path that exists in current code.
- [X] Surviving drone settings path persists `attributeDroneIsAggressive` and `attributeDroneFocusFire`, and current runtime applies those settings to non-fleet aggressive wake behavior.
- [X] Surviving disconnect-style detach recalls nearby controlled drones into bay and removes them from already-ballparked observers.
- [X] Surviving disconnect/logoff cleanup now also recalls nearby launched fighters into their originating tubes and removes them from already-ballparked observers through the shared session-disconnect path.
- [X] Surviving jump-style detach abandons launched drones immediately instead of waiting for a later scene tick.
- [X] Surviving same-scene ship destruction abandons launched drones before the controlling hull is removed.
- [X] Surviving drone destruction cleanup emits controller state cleanup and `RemoveBalls` to already-ballparked observers.
- [X] Surviving drone launch/recall observer path sends `AddBalls2` and `RemoveBalls` to already-ballparked observers.
- [X] Surviving drone bay damage fetch path `GetLayerDamageValuesByItems(...)` returns keyed drone-bay `KeyVal` payloads with `shieldInfo`, `armorInfo`, `hullInfo`, `armorDamage`, and `hullDamage`, and stays marshal-safe on the wire.
- [X] Surviving fighter bay inventory path lists the active ship's real fighter bay contents.
- [X] Surviving fighter tube inventory path loads/unloads fighters from ship inventory and supports docked hangar-to-tube loading for the active ship.
- [X] Surviving fighter tube loading enforces legal squadron sizing and avoids accepting arbitrarily oversized stacks as one tube load.
- [X] Surviving fighter launch path creates real in-space fighter squadrons and reports `fightersInSpace`.
- [X] Surviving fighter movement path covers orbit, follow, goto, and stop.
- [X] Surviving fighter recall path returns launched squadrons to their launch tubes and restores tube payload state.
- [X] Surviving fighter abandon and scoop paths clear controller state and recover abandoned fighters back into fighter bay inventory.
- [X] Surviving jump-style detach abandons launched fighters immediately instead of waiting for a later scene tick.
- [X] Surviving same-scene ship destruction abandons launched fighters before the controlling hull is removed.
- [X] Surviving foreign abandoned fighter recovery into the scooping carrier fighter bay exists and is regression-tested.
- [X] Surviving fighter launch/recall observer path sends `AddBalls2` and `RemoveBalls` to already-ballparked observers.
- [X] Surviving fighter ability metadata is sourced from extracted client fighter ability data, including slot ordering, cooldowns, and charge timings.
- [X] Surviving fighter ability activation returns per-fighter dict-shaped results and emits the live slot notifications the client currently expects for the covered families.
- [X] Surviving fighter offensive slot 0 combat repeats as a live combat cycle and damages the target ship.
- [X] Surviving fighter slot 2 salvo-style combat applies live damage during its activation window for the covered families.
- [X] Surviving fighter charge abilities consume charges and rearm on the extracted timing for the covered families.
- [X] Surviving fighter member loss emits `OnInSpaceSquadronSizeChanged` and observer slim updates.
- [X] Surviving full fighter squadron destruction removes controller rows and sends `RemoveBalls` to observers.
- [X] Surviving fighter offensive combat FX remain visible to observers under TiDi without backstepping behind live history for the covered families.
- [X] Surviving fighter MWD, MJD, and evasive maneuver runtime exists and is regression-tested for the covered families.

## Authority And Research Map

Primary CCP client/code references already used for this tracker rebuild:

- `_local/codeccpfull/code/eve/client/script/util/eveMisc.py`
- `_local/codeccpfull/code/eve/client/script/ui/services/menuSvcExtras/droneFunctions.py`
- `_local/codeccpfull/code/eve/client/script/ui/inflight/drones/dronesUtil.py`
- `_local/codeccpfull/code/eve/client/script/ui/inflight/drones/droneEntry.py`
- `_local/codeccpfull/code/eve/client/script/ui/inflight/drones/droneGroup.py`
- `_local/codeccpfull/code/eve/client/script/ui/inflight/drones/droneSettings.py`
- `_local/codeccpfull/code/menucheckers/droneCheckers.py`
- `_local/codeccpfull/code/eve/client/script/parklife/fightersSvc.py`
- `_local/codeccpfull/code/eve/client/script/ui/inflight/squadrons/shipFighterState.py`
- `_local/codeccpfull/code/fighters/__init__.py`
- `_local/codeccpfull/code/fighters/storages.py`

Live client traces already used for surviving parity recovery:

- `client/launch.txt`
- `client/LAG.txt`
- `client/badlag.txt`
- `client/badlag2.txt`
- `client/these.txt`
- `client/fighter.txt`
- `client/fighters2.txt`
- `client/fighters3.txt`
- `client/fighters5.txt`
- `client/attack.txt`
- `client/attack2.txt`
- `client/attack3.txt`

## Data Sources In This Workspace

Current local server database/cache sources used by surviving code:

- `server/src/newDatabase/data/items`
- `server/src/newDatabase/data/itemTypes`
- `server/src/newDatabase/data/typeDogma`
- `server/src/newDatabase/data/shipDogmaAttributes`
- `server/src/newDatabase/data/characters`
- `server/src/newDatabase/data/fighterAbilities`

Current static-data state in this workspace:

- Present: `data/eve-online-static-data-3279491-yaml`
- Present: extracted fighter ability table under `server/src/newDatabase/data/fighterAbilities/data.json`
- Not present right now: `data/eve-online-static-data-3263238-jsonl`

Rule: no SDE file or client static should ever be read on the hot runtime path. Anything needed for runtime must be copied into the local JSON-backed server database/cache first.

## Current Server Implementation Map

- Drone runtime authority: `server/src/services/drone/droneRuntime.js`
- Drone command moniker: `server/src/services/drone/entityService.js`
- Drone launch/scoop ship service surface: `server/src/services/ship/shipService.js`
- Drone settings and drone-bay damage payloads: `server/src/services/dogma/dogmaService.js`
- Fighter runtime authority: `server/src/services/fighter/fighterRuntime.js`
- Fighter service surface and tube/bay RPCs: `server/src/services/fighter/fighterMgrService.js`
- Fighter slot metadata and effect-family resolution: `server/src/services/fighter/fighterAbilities.js`
- Fighter dogma resolution: `server/src/services/fighter/fighterDogma.js`
- Shared runtime integration points only: `server/src/space/runtime.js`, `server/src/space/destiny.js`, `server/src/space/shipDestruction.js`

## Performance Rules

- Keep drone and fighter behavior in their dedicated services. `runtime.js` should only call into narrow helper hooks.
- No broad per-tick scans of every dynamic entity when a scene-local index can be maintained instead.
- No disk reads, SDE reads, or client-static reads on activation, launch, recall, or tick paths.
- Cache dogma/type snapshots once and reuse them for hot combat/mining/ability loops.
- Use scene time / TiDi-aware timing for recurring effects, not ad hoc wall-clock drift.
- Broadcast only to interested controller/observer sessions. Never emit global notifications for local drone/fighter actions.
- Prefer state mutation on existing in-memory entities plus narrow persistence writes over remove/recreate churn.
- Every client-visible payload must be marshal-safe before it is called "done".
- Any new parity slice needs both correctness verification and scale verification before it can be marked complete.

## Implementation Guide For New Work

1. Prove the client contract first.
   Read `_local/codeccpfull` and the matching `client/*.txt` trace before editing server behavior.

2. Find the real server authority source.
   Prefer extracted client data already copied into `server/src/newDatabase/data/*`. If it is missing there, add a one-time extraction/import path first.

3. Keep hot logic out of `runtime.js`.
   Add the behavior in `droneRuntime.js`, `fighterRuntime.js`, or their dogma/helpers, then expose only a narrow runtime hook if the scene loop truly needs it.

4. Match wire shape before polishing behavior.
   If the client expects a keyed dict, rowset, tuple, or `KeyVal`, implement that exact marshal-safe payload first. A "working" action with the wrong reply shape is still broken.

5. Add a regression before claiming parity.
   Every fixed trace or recovered behavior needs a dedicated test in:
   `server/tests/droneRuntimeParity.test.js`
   `server/tests/fighterRuntimeParity.test.js`
   `server/tests/droneFighterInventoryParity.test.js`
   `server/tests/droneSettingsParity.test.js`
   `server/tests/droneBayDamageFetchParity.test.js`

6. Only move TODO to DONE when all of these are true.
   `_local/codeccpfull` agrees, live client trace agrees, server test exists, and the hot path still respects the performance rules above.

## Notes

- This tracker is intentionally conservative. If a feature existed before the corruption but is not re-proven in current code/tests, it stays TODO here.
- If the older JSONL SDE mirror is restored later, update this file to point at the exact restored path and record what was imported into local JSON cache from it.
