<!--
Proof-of-authorship note: Primary authorship and project direction for this tracker document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# NPC / CONCORD Scaling Tracker

Updated: 2026-03-21

## CURRENT TASK

- Current working slice is now: post-Step-5 hardening and soak complete on top of the completed Step 0 audit/benchmark harness, Step 1 per-system controller index, Step 2 cold-scene sleep, Step 3 ambient CONCORD virtualization, Step 4 unobserved combat-NPC dormancy, and Step 5 per-anchor / per-public-grid wake.
- Completed in the current implementation pass:
  - `Step 0` measurement + stale-data audit tooling
  - `Step 1` live per-system NPC controller index
  - `Step 2` cold-scene sleep + wake-before-visibility path
  - `Step 3` ambient CONCORD virtualization
  - `Step 4` unobserved combat-NPC dormancy
  - `Step 5` per-anchor / per-public-grid wake
- Latest measured Step 5 benchmark snapshot from `scripts/internal/benchmark_npc_scaling.js --modes=1 --json`:
  - `Anchor relevance disabled, Ambient On / Lazy Default`: startup `1788.857 ms`, runtime tick `0.018 ms`, first ensure `3194.693 ms`, first relevant wake `2347.182 ms`, `90` ambient ships materialized, `0` ambient ships left virtualized in the sample wake
  - `Anchor relevance enabled, Ambient On / Lazy Default`: startup `1874.856 ms`, runtime tick `0.019 ms`, first ensure `3152.658 ms`, first relevant wake `189.322 ms`, `5` ambient ships materialized, `78` ambient ships left virtualized in the sample wake
  - `Anchor relevance disabled, Combat Startup On / Lazy Default`: startup `104.218 ms`, runtime tick `0.018 ms`, first ensure `45.777 ms`, first relevant wake `58.762 ms`, `11` combat ships materialized, `0` combat ships left virtualized in the sample wake
  - `Anchor relevance enabled, Combat Startup On / Lazy Default`: startup `104.854 ms`, runtime tick `0.019 ms`, first ensure `51.209 ms`, first relevant wake `19.982 ms`, `3` combat ships materialized, `7` combat ships left virtualized in the sample wake
- The public benchmark wrapper now restores the tracked DB files byte-for-byte after each run, so the supported benchmark path leaves the working tree clean.
- Immediate next execution step:
  - keep the Step 0-5 safety suite and benchmark harness current
  - refresh the human-readable reporting/visualization from the measured results
  - only start a new live slice once a new scaling or parity goal is chosen
- Hard constraints for every future step:
  - keep one shared source of truth for startup rules, wake logic, and NPC runtime actions
  - do not fork player movement / player warp / player module code to solve NPC scaling
  - keep `runtime.js` changes as thin integration points; prefer new NPC-specific helper files
  - all tests that pass before a step must still pass after that step
  - after every step, verify the database/runtime tables are not left with stale test residue
  - no git commits until explicitly requested by the user

## DONE

- [X] Live NPCs and CONCORD are on the native entity/runtime path, not the old fake-player ownership path.
- [X] Shared NPC runtime helpers already exist for spawn, warp, follow, orbit, stop, despawn, and controller wake.
- [X] Crimewatch response CONCORD uses the native NPC substrate and shared runtime helpers.
- [X] Manual `/npc`, `/concord`, `/npcw`, `/wnpc`, and gate startup/operator flows already route through native NPC/CONCORD services.
- [X] Current authored CONCORD and Blood Raider combat loadouts are already on the native module/cargo/controller tables, with player combat-module leakage removed from the current supported profiles.
- [X] The main startup/idle bottlenecks are already identified:
  - global controller scans in `server/src/space/npc/npcRegistry.js`
  - scene ticks continuing for loaded-but-empty scenes in `server/src/space/runtime.js`
  - passive ambient CONCORD still being materialized as real moving ships
  - gate rats still costing real materialization/runtime when nobody can observe them
- [X] The implementation order below is intentionally ranked from safest / most player-invisible win to largest architectural win.
- [X] Step 0: measurement + stale-data audit harness landed.
  - `scripts/internal/audit_npc_runtime_tables.js` now snapshots and compares the key runtime/player tables using stable semantic hashes.
  - `scripts/internal/benchmark_npc_scaling.js` + `scripts/internal/benchmark_npc_scaling_worker.js` now measure startup preload, full runtime tick cost, first-scene ensure, steady-state scene tick, and controller counts.
  - the public wrapper restores tracked DB files after each benchmark run so the supported benchmark path is clean.
- [X] Step 1: per-system NPC controller index landed.
  - `server/src/space/npc/npcRegistry.js` now keeps a `controllersBySystemID` index instead of scanning the whole controller map for every scene tick.
  - the registry now self-heals if `controller.systemID` is mutated behind its back.
  - focused coverage lives in `server/tests/npcRegistryIndex.test.js`.
- [X] Step 2: cold-scene sleep landed.
  - `server/src/space/npc/npcSceneActivity.js` is now the shared source of truth for cold-scene decisions, next deadlines, and startup presence summary counts.
  - `server/src/space/runtime.js` now skips cold scenes in the main runtime tick and wakes/catches up a cold scene before direct session entry.
  - startup preload logging now prints the live NPC/CONCORD startup settings plus total CONCORD/NPC startup ships across gates/anchors/systems.
  - focused coverage lives in `server/tests/npcSceneActivity.test.js`.
- [X] Step 3: ambient CONCORD virtualization landed.
  - `server/src/space/npc/npcAmbientMaterialization.js` is now the shared source of truth for passive ambient startup CONCORD virtualization, wake-time materialization, and cold-scene dematerialization.
  - `server/src/space/npc/npcService.js` now seeds passive startup/default CONCORD into transient native rows as `nativeAmbient` descriptors in cold scenes instead of materializing live orbiting ships.
  - `server/src/space/runtime.js` now materializes those ambient rows during the wake-before-visibility path and dematerializes pristine passive ambient CONCORD again when the last session leaves the scene.
  - startup preload logging and the benchmark harness now report live versus virtualized startup presence, plus first-wake materialization cost.
  - focused coverage lives in `server/tests/npcAmbientMaterialization.test.js`.
- [X] Step 4: unobserved combat-NPC dormancy landed.
  - `server/src/space/npc/npcCombatDormancy.js` is now the shared source of truth for cold-scene combat startup virtualization, wake-time combat materialization, and post-combat dematerialization once unobserved combat NPCs are back in a stable idle/home state.
  - `server/src/space/npc/npcService.js` now seeds safe cold-scene startup/operator combat spawns into transient native rows instead of immediately materializing live combat ships.
  - `server/src/space/runtime.js` now materializes dormant combat controllers during the wake-before-visibility path and dematerializes quiescent startup/operator combat NPCs again when the last session leaves or once an unobserved fight fully cools down.
  - startup preload logging and the benchmark harness now report virtualized combat startup presence and first-wake combat materialization cost.
  - focused coverage lives in `server/tests/npcCombatDormancy.test.js`.
- [X] Step 5: per-anchor / per-public-grid wake landed.
  - `server/src/space/npc/npcAnchorRelevance.js` is now the shared source of truth for session-visible startup anchor relevance, targeted wake-time materialization, and hot-scene dematerialization of irrelevant startup anchors.
  - `server/src/space/runtime.js` now passes attach-time relevance positions into the wake path and synchronizes relevant startup anchors immediately before dynamic visibility sync in hot scenes.
  - active off-cluster startup combat intentionally stays live until it cools down; only dormant irrelevant startup combat dematerializes.
  - focused coverage lives in `server/tests/npcAnchorRelevance.test.js`.
- [X] Post-Step-5 hardening: known player warp destinations now pre-wake relevant startup anchors before the player leaves the source cluster.
  - `server/src/space/npc/npcAnchorRelevance.js` now exposes a shared warp-destination pre-warm helper instead of duplicating wake logic in `runtime.js`.
  - `server/src/space/runtime.js` now calls that helper from the successful player warp-start path using the known destination point/entity, while keeping the source cluster live until the player actually leaves it.
  - focused coverage lives in `server/tests/npcAnchorRelevance.test.js`.
- [X] Post-Step-5 hardening + soak coverage landed.
  - `server/tests/npcAnchorRelevance.test.js` now covers multi-session different-cluster relevance, last-session leave behavior, and preparing-warp cancel rollback for destination pre-warm.
  - `scripts/internal/soak_npc_scaling.js` now runs repeated anchor-relevance/materialization/dormancy regressions plus the benchmark harness and DB audit in one repeatable soak pass.

## TODO

- [ ] After each completed step:
  - update `CURRENT TASK`
  - move the step from `TODO` to `DONE`
  - refresh the tables in `Scenario Math`
  - append the exact verification commands and results
  - confirm the DB/runtime tables are clean

## Goals

- Make `gate CONCORD on everywhere` and `gate rats on everywhere` viable without crushing startup, empty-system idle cost, or login responsiveness.
- Keep player-facing behavior unchanged:
  - NPCs and CONCORD still appear already present where they should be
  - Crimewatch CONCORD still warps/responds correctly
  - no visible pop-in caused by the optimization layer
  - no changes to player module, radial, weapon, warp, or movement behavior
- Keep one source of truth for:
  - which systems/anchors should have NPC/CONCORD presence
  - which runtime path should materialize it
  - which shared helper should wake, sleep, despawn, or rehydrate it

## Non-Goals

- Do not build a second NPC implementation just for scaling.
- Do not move startup logic into ad hoc `runtime.js` branches if a dedicated NPC helper/module can own it.
- Do not accept player-facing desync just to hide server work.
- Do not change passing tests to match broken behavior.

## One Source Of Truth

- Startup/default presence authority stays here:
  - `server/src/space/npc/npcDefaultConcordRules.js`
  - `server/src/newDatabase/data/npcStartupRules/`
  - `server/src/space/npc/npcControlState.js`
- Shared runtime actions stay here:
  - `server/src/space/npc/npcRuntime.js`
  - `server/src/space/npc/npcBehaviorLoop.js`
  - `server/src/space/npc/nativeNpcService.js`
- Shared controller registry stays here:
  - `server/src/space/npc/npcRegistry.js`
- Shared visibility/wake/materialization helpers should become their own NPC files, not giant new `runtime.js` branches:
  - live `server/src/space/npc/npcSceneActivity.js`
  - live `server/src/space/npc/npcAmbientMaterialization.js`
  - live `server/src/space/npc/npcCombatDormancy.js`
  - live `server/src/space/npc/npcAnchorRelevance.js`
  - proposed `server/src/space/npc/npcScalingMetrics.js`
- `runtime.js` should only own the narrow scene integration points:
  - scene tick / scene wake
  - session enters/leaves scene
  - teleport/jump/undock hooks
  - no duplicated NPC business logic there

## Always-Green Safety Suite

Run this before and after every step, plus the focused new tests for that step.

- `node --test server/tests/npcEquipment.test.js`
- `node --test server/tests/chatCommandsNpcWarp.test.js`
- `node --test server/tests/npcSceneActivity.test.js`
- `node --test server/tests/npcAmbientMaterialization.test.js`
- `node --test server/tests/npcCombatDormancy.test.js`
- `node --test server/tests/npcAnchorRelevance.test.js`
- `node scripts/internal/selftest_npc_startup_rules.js`
- `node scripts/internal/selftest_default_concord_startup_config.js`
- `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
- `node scripts/internal/selftest_npc_operator_controls.js`
- `node scripts/internal/selftest_gateconcord_transient_persistence.js`
- `node scripts/internal/selftest_crimewatch_concord_response.js`
- `node scripts/internal/selftest_crimewatch_concord_station_response.js`
- `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
- `node scripts/internal/selftest_destiny_warp_bootstrap.js`

## Stale-Data Guardrail

Every step ends with a DB/runtime audit. If a new helper script is added in `Step 0`, it becomes mandatory.

Minimum cleanup check:

- `server/src/newDatabase/data/npcEntities/data.json`
- `server/src/newDatabase/data/npcModules/data.json`
- `server/src/newDatabase/data/npcCargo/data.json`
- `server/src/newDatabase/data/npcRuntimeControllers/data.json`
- `server/src/newDatabase/data/npcRuntimeState/data.json`
- `server/src/newDatabase/data/characters/data.json`
- `server/src/newDatabase/data/items/data.json`
- `server/src/newDatabase/data/skills/data.json`

Required rule:

- if the step did not explicitly intend to leave persistent rows behind, these files must either remain unchanged or be restored before the step is considered complete

## Measurement Model

These tables are planning estimates, not promises. They are meant to keep every step measurable and comparable.

Planner assumptions:

- highsec systems: `1247`
- all systems: `8490`
- highsec gates: `3629`
- all-system gates: `13968`
- highsec default CONCORD gate groups: `5495`
- all-system hypothetical gate CONCORD groups with current security-band sizing: `15834`
- expected gate CONCORD ships per group: `3.0`
  - `2` fixed ships
  - plus two optional `0..1` entries modeled at midpoint `0.5 + 0.5`
- expected gate rat ships per gate group: `3.5`
  - `3` fixed ships
  - plus one optional `0..1` pool entry modeled at midpoint `0.5`
- average active ships per hot highsec system:
  - gate CONCORD only: `13.23`
  - gate CONCORD + gate rats: `23.42`
- average active ships per observed gate/public-grid anchor after Step 5:
  - gate CONCORD only: `4.54`
  - gate CONCORD + gate rats: `8.04`
- startup delay estimate uses the local observed preload tax:
  - about `46.5 ms` per materialized ambient ship on the current architecture
- TiDi estimate uses a rough hottest-scene planning model from the same local measurements:
  - about `5.74 ms` of tick work per hot active NPC/CONCORD ship
  - this is only a planning proxy for NPC-only pressure, not a live authoritative TiDi reading

Important player-count assumption:

- the `1 / 10 / 100 / 500 player` tables assume players are spread across distinct hot gate grids/systems
- if many players stack on the same gate, total server work is lower than the distributed case below

## Ranked Implementation Guide

### Step 0: Benchmark + Audit Harness

Goal:

- freeze a trustworthy before-state before behavior changes start

Implementation:

- add a focused benchmark script, likely under `scripts/internal/`, that records:
  - preload time
  - first scene wake/materialization time
  - steady-state tick cost
  - live controller count
  - live dynamic ship count
- add one stale-data audit script that proves no unwanted rows were left behind
- add one shared metrics helper, likely `server/src/space/npc/npcScalingMetrics.js`, so later steps reuse the same measurement code instead of inventing new log parsing each time

Verification:

- record baseline numbers for:
  - gate CONCORD only
  - gate CONCORD + gate rats
  - highsec scope
  - all-system scope if the benchmark supports it safely
- save the exact commands and outputs into this doc

DB cleanup:

- the audit script becomes mandatory at the end of every later step

Status:

- Complete on `2026-03-21`.

Verification history:

- `node scripts/internal/audit_npc_runtime_tables.js --write-baseline <tempfile>`
- `node scripts/internal/audit_npc_runtime_tables.js --compare-baseline <tempfile>`
- `node scripts/internal/benchmark_npc_scaling.js --modes=1`
- Always-green suite run on the scripts-only slice:
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`

Notes:

- The new audit script immediately proved useful: the always-green suite left real changes in `items/data.json`, `characters/data.json`, and `npcControlState/data.json`, so end-of-step cleanup must include restoring those files when the step did not intend to persist them.
- The benchmark worker needed an additional parent-wrapper raw file restore before the public benchmark path became clean; that is now in place.

### Step 1: Per-System Controller Index

Goal:

- remove the global controller-map scan from every scene tick

Implementation:

- extend `server/src/space/npc/npcRegistry.js` to maintain:
  - `controllersByEntityID`
  - `controllersBySystemID`
- update register/unregister/system-change paths once, centrally
- keep `listControllersBySystem(systemID)` as the public API so the rest of the code keeps one shared entry point
- do not change behavior timing or wake rules in this step

Why first:

- this is low risk, player invisible, and immediately deletes the worst wasted lookup pattern

Verification:

- add focused unit coverage for:
  - register
  - unregister
  - moving a controller between systems
  - sorted deterministic iteration
- rerun the always-green suite
- rerun the benchmark harness and refresh the tables below

DB cleanup:

- audit script must pass

Status:

- Complete on `2026-03-21`.

Verification history:

- Focused coverage:
  - `node --test server/tests/npcRegistryIndex.test.js`
- Benchmark spot-check after the index change:
  - `node scripts/internal/benchmark_npc_scaling.js --modes=1`
- Always-green suite run after the live index landed:
  - `node --test server/tests/npcRegistryIndex.test.js`
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`
- Post-step cleanup:
  - restore dirty runtime data files with `git restore -- server/src/newDatabase/data/characters/data.json server/src/newDatabase/data/items/data.json server/src/newDatabase/data/npcControlState/data.json`
  - rerun `node scripts/internal/audit_npc_runtime_tables.js`

Notes:

- This step changed only the NPC registry internals; no player-facing movement, warp, combat, or packet contracts were touched.
- The registry now preserves the old public API while removing the `listControllersBySystem()` full-map scan.

### Step 2: Cold-Scene Sleep

Goal:

- empty scenes stop ticking entirely

Implementation:

- add a shared scene-activity helper, likely `server/src/space/npc/npcSceneActivity.js`
- track:
  - undocked sessions in scene
  - pending wake deadlines
  - pending despawn deadlines
  - forced-wake reasons
- gate `scene.tick(now)` so cold scenes are skipped
- wake synchronously before:
  - undock
  - jump arrival
  - teleport
  - direct session scene entry
  - any action that would expose NPCs/CONCORD to the client

Why this does not change player experience:

- players only ever see the scene after wake/materialization is complete
- empty scenes have no player-visible continuity to preserve

Verification:

- add focused tests for:
  - cold scene does not tick
  - first player entry wakes it before visibility sync
  - Crimewatch despawn deadlines still fire without keeping the whole scene hot
- rerun the always-green suite
- rerun the benchmark harness and refresh the tables below

DB cleanup:

- audit script must pass

Status:

- Complete on `2026-03-21`.

Verification history:

- Focused coverage:
  - `node --test server/tests/npcSceneActivity.test.js`
- Measured before/after benchmark using the internal toggle:
  - `EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP=1 node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
  - `node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
- Always-green suite run after the live cold-scene sleep landed:
  - `node --test server/tests/npcSceneActivity.test.js`
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`
- Post-step cleanup proof:
  - `node scripts/internal/audit_npc_runtime_tables.js --write-baseline <tempfile>`
  - run the full suite
  - `node scripts/internal/audit_npc_runtime_tables.js --compare-baseline <tempfile>`

Notes:

- Step 2 added one internal benchmark-only env flag, `EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP=1`, so the same harness can measure true before/after runtime tick cost without checking files in and out.
- Startup preload now logs the effective NPC startup config plus live CONCORD/NPC totals across gates, anchors, and systems.

### Step 3: Ambient CONCORD Virtualization

Goal:

- passive startup/default CONCORD should be descriptors in cold scenes, not live ships

Implementation:

- add a shared materialization helper, likely `server/src/space/npc/npcAmbientMaterialization.js`
- keep the rule/config source of truth exactly where it already is
- convert cold-scene ambient CONCORD from:
  - materialized entity + controller + orbit state
  - into descriptor-only ambient presence keyed by startup rule + anchor
- materialize when a hot scene/anchor actually needs it
- dematerialize when it becomes cold again

Why this is safe:

- passive ambient CONCORD has no meaningful hidden combat history to preserve while unobserved
- Crimewatch/manual/transient response remains on the live native runtime path

Verification:

- add focused tests for:
  - default CONCORD rules still resolve the same anchors
  - cold scenes do not create live ambient ships
  - first relevant player still sees CONCORD already present
- rerun the always-green suite
- rerun the benchmark harness and refresh the tables below

DB cleanup:

- audit script must pass

Status:

- Complete on `2026-03-21`.

Verification history:

- Focused coverage:
  - `node --test server/tests/npcAmbientMaterialization.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_default_concord_startup_config.js`
- Always-green suite rerun on the Step 3 slice:
  - `node --test server/tests/npcSceneActivity.test.js`
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`
- Measured before/after benchmark pair:
  - `EVEJS_DISABLE_NPC_AMBIENT_VIRTUALIZATION=1 node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
  - `node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
- Post-step audit:
  - `node scripts/internal/audit_npc_runtime_tables.js`

Notes:

- Step 3 adds one new internal benchmark-only env flag, `EVEJS_DISABLE_NPC_AMBIENT_VIRTUALIZATION=1`, so the same harness can measure true before/after startup and first-wake cost without checking files in and out.
- The measured result matches the intended tradeoff: passive startup CONCORD is no longer front-loading live ship materialization at preload, but the first wake of a cold CONCORD-heavy scene now pays the materialization cost immediately before player visibility.

### Step 4: Unobserved Combat-NPC Dormancy

Goal:

- gate rats and other unobserved combat NPCs stop costing cold-scene runtime and startup materialization

Implementation:

- extend the shared materialization/sleep helpers instead of forking a second rat-only system
- keep combat NPCs as rule-backed dormant descriptors when they are:
  - unobserved
  - not in active combat
  - not inside a must-stay-live deadline window
- keep absolute timers for:
  - respawn
  - despawn
  - Crimewatch response cleanup
  - other authored lifecycle deadlines

Why this is safe:

- if no player can observe or interact with the spawn, there is no player-facing difference between a dormant descriptor and a live moving ship

Verification:

- add focused tests for:
  - gate rats do not materialize in cold scenes
  - first relevant player wakes/materializes them before visibility
  - transient Crimewatch/manual responders still despawn correctly when no player remains
- rerun the always-green suite
- rerun the benchmark harness and refresh the tables below

DB cleanup:

- audit script must pass

Status:

- Complete on `2026-03-21`.

Verification history:

- Focused coverage:
  - `node --test server/tests/npcCombatDormancy.test.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
- Always-green suite rerun on the Step 4 slice:
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node --test server/tests/npcSceneActivity.test.js`
  - `node --test server/tests/npcAmbientMaterialization.test.js`
  - `node --test server/tests/npcCombatDormancy.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_default_concord_startup_config.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`
- Measured before/after benchmark pair:
  - `EVEJS_DISABLE_NPC_COMBAT_DORMANCY=1 node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
  - `node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
- Post-step audit:
  - `node scripts/internal/audit_npc_runtime_tables.js`

Notes:

- Step 4 adds one new internal benchmark-only env flag, `EVEJS_DISABLE_NPC_COMBAT_DORMANCY=1`, so the same harness can measure true before/after cold combat-startup cost without checking files in and out.
- Active combat intentionally stays live when unobserved. Dormancy only starts once startup/operator NPCs are untargeted, not recently aggressed, and back in a stable home/orbit state. That preserves the player-facing “fight plays out, then the grid goes quiet” behavior instead of letting players catch a visibly paused battle.

### Step 5: Per-Anchor / Per-Public-Grid Wake

Goal:

- one hot system should not pay for every gate and station anchor in that system

Implementation:

- add a shared anchor relevance helper, likely `server/src/space/npc/npcAnchorRelevance.js`
- narrow hot-scene materialization from:
  - all anchors in the system
  - to only the relevant anchor/public-grid groups a player can actually observe or imminently enter
- integrate with the same wake/materialization helper from Steps 2 to 4
- do not duplicate gate-specific versus station-specific wake logic; keep anchor selection generic

Why this matters:

- this is the step that changes scaling from `whole system cost` to `observed anchor cost`

Verification:

- add focused tests for:
  - player at gate A does not pay for gate B / station C in the same system
  - moving to a different relevant anchor materializes only that anchor
  - stacked players on one anchor share one live NPC set instead of multiplying it
- rerun the always-green suite
- rerun the benchmark harness and refresh the tables below

DB cleanup:

- audit script must pass

Status:

- Complete on `2026-03-21`.

Verification history:

- Focused coverage:
  - `node --test server/tests/npcAnchorRelevance.test.js`
- Updated legacy focused coverage:
  - `node --test server/tests/npcAmbientMaterialization.test.js`
  - `node --test server/tests/npcCombatDormancy.test.js`
- Always-green suite rerun on the Step 5 slice:
  - `node --test server/tests/npcAnchorRelevance.test.js`
  - `node --test server/tests/npcSceneActivity.test.js`
  - `node --test server/tests/npcEquipment.test.js`
  - `node --test server/tests/chatCommandsNpcWarp.test.js`
  - `node scripts/internal/selftest_npc_startup_rules.js`
  - `node scripts/internal/selftest_default_concord_startup_config.js`
  - `node scripts/internal/selftest_npc_runtime_only_pirate_startup.js`
  - `node scripts/internal/selftest_npc_operator_controls.js`
  - `node scripts/internal/selftest_gateconcord_transient_persistence.js`
  - `node scripts/internal/selftest_crimewatch_concord_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_station_response.js`
  - `node scripts/internal/selftest_crimewatch_concord_large_public_grid_response.js`
  - `node scripts/internal/selftest_destiny_warp_bootstrap.js`
- Measured before/after benchmark pair:
  - `EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE=1 node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
  - `node scripts/internal/benchmark_npc_scaling.js --modes=1 --json`
- Post-step audit:
  - `node scripts/internal/audit_npc_runtime_tables.js`

Notes:

- Step 5 adds one new internal benchmark-only env flag, `EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE=1`, so the same harness can measure true before/after hot-scene anchor relevance without reverting files.
- Explicit `wakeSceneForImmediateUse(systemID)` calls without session context still preserve the old whole-system wake behavior. Anchor relevance only takes over when the runtime has a real visibility context: an entering ship position, an entering entity, or already-live sessions in the scene.
- Dynamic gate/operator fights now scale with the player-visible gate/public-grid cluster instead of the whole system. Active off-cluster fights still stay live until they cool down, so players do not catch visibly paused combat by leaving and returning.

## Scenario Math

Table notes:

- zero-player scope table cells are `startup delay ; idle loop work`
- player table cells are `runtime work ; estimated NPC-only TiDi kick-in`
- `Current` and `Step 1` assume highsec/all-system preload remains hot until `Step 2`
- `Step 3` mostly improves startup/materialization, not hot runtime yet
- `Step 5` is where hot runtime drops from whole-system average to observed-anchor average

Standard quick-read benchmark rows used below:

- `Highsec, gate CONCORD + gate rats, 0 players`
- `All systems, gate CONCORD + gate rats, 0 players`
- `1 player, gate CONCORD + gate rats`
- `10 players, gate CONCORD + gate rats`
- `500 players, gate CONCORD + gate rats`

That keeps the handoff summary consistent. When the short breakdown says `before`, `after`, or `compared to no steps done`, it is referring back to one of those same rows rather than switching to a different example halfway down the page.

### Zero-Player Preload Scope

| Scenario                                      | Baseline materialized ships | Current                                  | Step 1                                 | Step 2                          | Step 3                          | Step 4                        | Step 5                        |
| --------------------------------------------- | --------------------------- | ---------------------------------------- | -------------------------------------- | ------------------------------- | ------------------------------- | ----------------------------- | ----------------------------- |
| Highsec, gate CONCORD only, 0 players         | 16.5k ships                 | 766.6s (12.8m) ; 205.75M/s (12.34B/min)  | 766.6s (12.8m) ; 342.17k/s (20.53M/min) | 766.6s (12.8m) ; 0/s (0/min)   | 0.0s (0.0m) ; 0/s (0/min)      | 0.0s (0.0m) ; 0/s (0/min)    | 0.0s (0.0m) ; 0/s (0/min)    |
| Highsec, gate CONCORD + gate rats, 0 players  | 29.2k ships                 | 1357.2s (22.6m) ; 364.27M/s (21.86B/min) | 1357.2s (22.6m) ; 596.21k/s (35.77M/min) | 1357.2s (22.6m) ; 0/s (0/min) | 590.6s (9.8m) ; 0/s (0/min)    | 0.0s (0.0m) ; 0/s (0/min)    | 0.0s (0.0m) ; 0/s (0/min)    |
| All systems, gate CONCORD only, 0 players     | 47.5k ships                 | 2208.8s (36.8m) ; 4.03B/s (242.01B/min)  | 2208.8s (36.8m) ; 1.03M/s (62.10M/min) | 2208.8s (36.8m) ; 0/s (0/min) | 0.0s (0.0m) ; 0/s (0/min)      | 0.0s (0.0m) ; 0/s (0/min)    | 0.0s (0.0m) ; 0/s (0/min)    |
| All systems, gate CONCORD + gate rats, 0 players | 96.4k ships              | 4482.1s (74.7m) ; 8.18B/s (491.07B/min)  | 4482.1s (74.7m) ; 2.01M/s (120.76M/min) | 4482.1s (74.7m) ; 0/s (0/min) | 2273.3s (37.9m) ; 0/s (0/min)  | 0.0s (0.0m) ; 0/s (0/min)    | 0.0s (0.0m) ; 0/s (0/min)    |

This table is cumulative, not isolated. `Current` means the server as it works today. `Step 1` means "today plus the per-system registry index", `Step 2` means "Step 1 plus cold-scene sleep", `Step 3` means "Steps 1-2 plus ambient CONCORD virtualization", and so on through `Step 5`.

The key reading is: `Step 1` mostly crushes idle lookup work but does not change startup time yet, because all of those ships are still being created. `Step 2` is the first column where empty space stops burning runtime entirely, because unloaded or empty scenes no longer tick. `Step 3` then removes the startup tax for passive CONCORD only, so the CONCORD-only rows drop to `0.0s` startup there while the `CONCORD + rats` rows still keep the rat startup cost until `Step 4`. By `Step 5`, both startup and empty-space idle cost are effectively zero in every zero-player scenario shown.

At a glance for the consistent zero-player benchmark rows:

`Highsec, gate CONCORD + gate rats, 0 players`

- `Before this step chain`: `1357.2s (22.6m)` startup ; `364.27M/s (21.86B/min)` idle loop work
- `After Step 1`: `1357.2s (22.6m)` startup ; `596.21k/s (35.77M/min)` idle loop work
- `After Step 2`: `1357.2s (22.6m)` startup ; `0/s (0/min)` idle loop work
- `After Step 3`: `590.6s (9.8m)` startup ; `0/s (0/min)` idle loop work
- `After Step 4 and Step 5`: `0.0s (0.0m)` startup ; `0/s (0/min)` idle loop work
- `TiDi estimated`: not applicable here, because this table is the `0 players` / no hot visible scene case
- `Compared to no steps done`: by `Step 4`, the modeled highsec zero-player startup and idle cost for `gate CONCORD + gate rats` is removed completely

`All systems, gate CONCORD + gate rats, 0 players`

- `Before this step chain`: `4482.1s (74.7m)` startup ; `8.18B/s (491.07B/min)` idle loop work
- `After Step 1`: `4482.1s (74.7m)` startup ; `2.01M/s (120.76M/min)` idle loop work
- `After Step 2`: `4482.1s (74.7m)` startup ; `0/s (0/min)` idle loop work
- `After Step 3`: `2273.3s (37.9m)` startup ; `0/s (0/min)` idle loop work
- `After Step 4 and Step 5`: `0.0s (0.0m)` startup ; `0/s (0/min)` idle loop work
- `TiDi estimated`: not applicable here, because this table is the `0 players` / no hot visible scene case
- `Compared to no steps done`: by `Step 4`, the modeled all-systems zero-player startup and idle cost for `gate CONCORD + gate rats` is removed completely

### Distributed Player Load

| Scenario                           | Hot-ship assumption            | Current                       | Step 1                         | Step 2                       | Step 3                       | Step 4                       | Step 5                      |
| ---------------------------------- | ------------------------------ | ----------------------------- | ------------------------------ | ---------------------------- | ---------------------------- | ---------------------------- | --------------------------- |
| 1 player, gate CONCORD only        | 13.23/system -> 4.54/anchor    | 177.58k/s (10.65M/min), 0%    | 12.73k/s (764.10k/min), 0%     | 275/s (16.50k/min), 0%      | 275/s (16.50k/min), 0%      | 275/s (16.50k/min), 0%      | 101/s (6.06k/min), 0%      |
| 10 players, gate CONCORD only      | 13.23/system -> 4.54/anchor    | 1.66M/s (99.81M/min), 0%      | 15.12k/s (906.96k/min), 0%     | 2.75k/s (164.76k/min), 0%   | 2.75k/s (164.76k/min), 0%   | 2.75k/s (164.76k/min), 0%   | 1.01k/s (60.48k/min), 0%   |
| 100 players, gate CONCORD only     | 13.23/system -> 4.54/anchor    | 16.52M/s (991.41M/min), 0%    | 38.93k/s (2.34M/min), 0%       | 27.46k/s (1.65M/min), 0%    | 27.46k/s (1.65M/min), 0%    | 27.46k/s (1.65M/min), 0%    | 10.08k/s (604.80k/min), 0% |
| 500 players, gate CONCORD only     | 13.23/system -> 4.54/anchor    | 82.57M/s (4.95B/min), 0%      | 144.77k/s (8.69M/min), 0%      | 137.30k/s (8.24M/min), 0%   | 137.30k/s (8.24M/min), 0%   | 137.30k/s (8.24M/min), 0%   | 50.40k/s (3.02M/min), 0%   |
| 1 player, gate CONCORD + gate rats | 23.42/system -> 8.04/anchor    | 304.75k/s (18.29M/min), 26%   | 12.94k/s (776.28k/min), 26%    | 478/s (28.68k/min), 26%     | 478/s (28.68k/min), 26%     | 478/s (28.68k/min), 26%     | 171/s (10.26k/min), 0%     |
| 10 players, gate CONCORD + gate rats | 23.42/system -> 8.04/anchor  | 2.94M/s (176.12M/min), 26%    | 17.15k/s (1.03M/min), 26%      | 4.78k/s (287.04k/min), 26%  | 4.78k/s (287.04k/min), 26%  | 4.78k/s (287.04k/min), 26%  | 1.71k/s (102.48k/min), 0%  |
| 100 players, gate CONCORD + gate rats | 23.42/system -> 8.04/anchor | 29.24M/s (1.75B/min), 26%     | 59.31k/s (3.56M/min), 26%      | 47.84k/s (2.87M/min), 26%   | 47.84k/s (2.87M/min), 26%   | 47.84k/s (2.87M/min), 26%   | 17.08k/s (1.02M/min), 0%   |
| 500 players, gate CONCORD + gate rats | 23.42/system -> 8.04/anchor | 146.15M/s (8.77B/min), 26%    | 246.67k/s (14.80M/min), 26%    | 239.20k/s (14.35M/min), 26% | 239.20k/s (14.35M/min), 26% | 239.20k/s (14.35M/min), 26% | 85.40k/s (5.12M/min), 0%   |

This table is also cumulative. Each later step includes every earlier one. The `Current` column is the expensive whole-system model, while `Step 5` is the final "only pay for what the player can actually observe" model.

The practical read is: `Step 1` is the dramatic low-risk drop, because it removes the global controller scan multiplier even while behavior stays identical. `Step 2` then cuts the remaining work down again by stopping empty scenes from ticking at all, but it does not yet change the cost of a scene that is genuinely hot. `Steps 3` and `4` are mainly startup/materialization wins, so their runtime numbers stay flat here. `Step 5` is where the hot-path math changes shape: instead of paying for every configured CONCORD and rat anchor in a hot system, the server only pays for the one gate or public-grid area the player is actually on, which is why the final column is the first one that clears the modeled NPC-only `26%` TiDi pressure in the `gate CONCORD + gate rats` cases.

At a glance for the consistent distributed-player benchmark rows:

`1 player, gate CONCORD + gate rats`

- `Before this step chain`: `304.75k/s (18.29M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 1`: `12.94k/s (776.28k/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 2`: `478/s (28.68k/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 3 and Step 4`: `478/s (28.68k/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 5`: `171/s (10.26k/min)` runtime work ; `0%` modeled NPC-only TiDi pressure
- `TiDi estimated`: the `%` at the end of each player-table cell is the modeled NPC-only TiDi pressure for that row
- `Compared to no steps done`: by `Step 5`, this modeled hot gate case drops from `304.75k/s` to `171/s`, and the estimated NPC-only TiDi pressure falls from `26%` to `0%`

`10 players, gate CONCORD + gate rats`

- `Before this step chain`: `2.94M/s (176.12M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 1`: `17.15k/s (1.03M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 2`: `4.78k/s (287.04k/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 3 and Step 4`: `4.78k/s (287.04k/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 5`: `1.71k/s (102.48k/min)` runtime work ; `0%` modeled NPC-only TiDi pressure
- `TiDi estimated`: the `%` at the end of each player-table cell is the modeled NPC-only TiDi pressure for that row
- `Compared to no steps done`: by `Step 5`, this modeled distributed 10-player gate case drops from `2.94M/s` to `1.71k/s`, and the estimated NPC-only TiDi pressure falls from `26%` to `0%`

`500 players, gate CONCORD + gate rats`

- `Before this step chain`: `146.15M/s (8.77B/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 1`: `246.67k/s (14.80M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 2`: `239.20k/s (14.35M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 3 and Step 4`: `239.20k/s (14.35M/min)` runtime work ; `26%` modeled NPC-only TiDi pressure
- `After Step 5`: `85.40k/s (5.12M/min)` runtime work ; `0%` modeled NPC-only TiDi pressure
- `TiDi estimated`: the `%` at the end of each player-table cell is the modeled NPC-only TiDi pressure for that row
- `Compared to no steps done`: by `Step 5`, this modeled 500-player all-systems-capable case drops from `146.15M/s` to `85.40k/s`, and the estimated NPC-only TiDi pressure falls from `26%` to `0%`

## Interpretation

- `Step 1` is the safest giant win:
  - it deletes the global-scan multiplier
  - it is player invisible
  - it does not yet solve startup materialization
- `Step 2` is the first point where empty-space idle loop cost becomes effectively zero
- `Step 3` is the first point where passive ambient CONCORD stops front-loading startup materialization
- `Step 4` is the first point where gate rats also stop front-loading startup materialization
- `Step 5` is the first point where hot-system cost becomes proportional to observed anchors instead of total anchors in the system

If we complete all five steps:

- zero-player startup/idle cost for gate CONCORD and gate rats can fall to effectively zero live runtime work
- player-visible gate behavior should stay unchanged
- the worst hot-path case changes from `whole configured system` to `what a player can actually observe`
- the rough NPC-only TiDi pressure in the worst modeled gate-CONCORD-plus-rats hot scene drops from about `26%` to `0%`

## Handoff Rules

Before stopping at any point:

- update `CURRENT TASK` with the exact live slice
- mark completed items in `DONE`
- unmark or rewrite stale items in `TODO`
- append any new benchmark numbers to `Scenario Math`
- write the exact commands run under the relevant step section
- note any failing test explicitly
- confirm DB/runtime stale-data cleanup status explicitly

If context compacts mid-step, this file should tell the next person:

- what the current step is
- what code area owns it
- which tests are the safety net
- what the measured before/after numbers are
- whether any stale data still needs cleanup
