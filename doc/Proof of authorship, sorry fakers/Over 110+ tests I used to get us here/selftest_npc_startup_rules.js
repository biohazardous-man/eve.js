/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const assert = require("assert");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const config = require(path.join(__dirname, "../../server/src/config"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const nativeNpcStore = require(path.join(__dirname, "../../server/src/space/npc/nativeNpcStore"));
const worldData = require(path.join(__dirname, "../../server/src/space/worldData"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  setStartupRuleEnabledOverride,
} = require(path.join(__dirname, "../../server/src/space/npc/npcControlState"));
const {
  listSystemSpaceItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const STARTUP_RULE_ID = "jita_concord_gate_checkpoint_startup";
const ITEMS_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/items/data.json",
);
const NATIVE_ENTITY_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcEntities/data.json",
);
const NATIVE_CONTROLLER_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcRuntimeControllers/data.json",
);
const NATIVE_MODULE_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcModules/data.json",
);
const NATIVE_CARGO_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcCargo/data.json",
);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function cleanupStartupRuleShips() {
  try {
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "concord",
      startupRuleIDs: [STARTUP_RULE_ID],
      removeContents: true,
    });
  } catch (error) {
    // Best-effort cleanup for selftests.
  }

  for (const controller of nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)) {
    if (String(controller && controller.startupRuleID || "").trim() !== STARTUP_RULE_ID) {
      continue;
    }
    try {
      runtime.removeDynamicEntity(TEST_SYSTEM_ID, controller.entityID, {
        allowSessionOwned: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      nativeNpcStore.removeNativeEntityCascade(controller.entityID);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
  }

  const systemItems = listSystemSpaceItems(TEST_SYSTEM_ID);
  for (const item of systemItems) {
    const npcMetadata = npcService.parseNpcCustomInfo(item && item.customInfo);
    if (!npcMetadata || npcMetadata.startupRuleID !== STARTUP_RULE_ID) {
      continue;
    }

    try {
      runtime.removeDynamicEntity(TEST_SYSTEM_ID, item.itemID, {
        allowSessionOwned: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      removeInventoryItem(item.itemID, {
        removeContents: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("skills", `/${item.ownerID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("characters", `/${item.ownerID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
  }
}

function getStartupSummaries() {
  return npcService.getNpcOperatorSummary()
    .filter((controller) => controller.startupRuleID === STARTUP_RULE_ID)
    .sort((left, right) => left.entityID - right.entityID);
}

function countPersistedStartupRuleShips() {
  const persistedItems = JSON.parse(fs.readFileSync(ITEMS_DATA_PATH, "utf8"));
  return Object.values(persistedItems).filter((item) => {
    const npcMetadata = npcService.parseNpcCustomInfo(item && item.customInfo);
    return (
      npcMetadata &&
      npcMetadata.startupRuleID === STARTUP_RULE_ID &&
      Number(item && item.locationID || 0) === TEST_SYSTEM_ID &&
      item &&
      item.spaceState &&
      Number(item.spaceState.systemID || 0) === TEST_SYSTEM_ID
    );
  }).length;
}

function countPersistedNativeStartupEntities() {
  const persistedEntities = JSON.parse(fs.readFileSync(NATIVE_ENTITY_DATA_PATH, "utf8"));
  return Object.values(persistedEntities && persistedEntities.entities || {}).filter((entity) => (
    Number(entity && entity.systemID || 0) === TEST_SYSTEM_ID &&
    String(entity && entity.startupRuleID || "").trim() === STARTUP_RULE_ID
  )).length;
}

function countPersistedNativeStartupControllers() {
  const persistedControllers = JSON.parse(fs.readFileSync(NATIVE_CONTROLLER_DATA_PATH, "utf8"));
  return Object.values(persistedControllers && persistedControllers.controllers || {}).filter((controller) => (
    Number(controller && controller.systemID || 0) === TEST_SYSTEM_ID &&
    String(controller && controller.startupRuleID || "").trim() === STARTUP_RULE_ID
  )).length;
}

function main() {
  const originalAuthoredStartupEnabled = config.npcAuthoredStartupEnabled;
  const originalTables = {
    npcEntities: database.read("npcEntities", "/").success ? cloneValue(database.read("npcEntities", "/").data) : {},
    npcModules: database.read("npcModules", "/").success ? cloneValue(database.read("npcModules", "/").data) : {},
    npcCargo: database.read("npcCargo", "/").success ? cloneValue(database.read("npcCargo", "/").data) : {},
    npcRuntimeControllers: database.read("npcRuntimeControllers", "/").success
      ? cloneValue(database.read("npcRuntimeControllers", "/").data)
      : {},
  };
  runtime._testing.clearScenes();
  clearControllers();
  cleanupStartupRuleShips();
  runtime._testing.clearScenes();
  clearControllers();

  try {
    config.npcAuthoredStartupEnabled = true;
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, true);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(scene, "expected startup test scene");

    const gateIDs = worldData.getStargatesForSystem(TEST_SYSTEM_ID).map((gate) => gate.itemID);
    assert(gateIDs.length > 0, "expected stargates in startup test system");

    const coldVirtualizedControllers = nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)
      .filter((controller) => String(controller && controller.startupRuleID || "").trim() === STARTUP_RULE_ID);
    assert(
      coldVirtualizedControllers.length > 0,
      "expected authored passive startup CONCORD to be virtualized into transient native rows on cold scene create",
    );

    const coldSummaries = getStartupSummaries();
    assert.strictEqual(
      coldSummaries.length,
      0,
      "cold scene create should not materialize live passive startup CONCORD controllers before wake",
    );

    const firstWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "startup-selftest-first-wake",
    });
    assert.strictEqual(firstWakeResult.success, true, firstWakeResult.errorMsg || "startup wake failed");
    assert(
      Number(
        firstWakeResult &&
        firstWakeResult.data &&
        firstWakeResult.data.ambientMaterialization &&
        firstWakeResult.data.ambientMaterialization.materializedCount ||
        0,
      ) > 0,
      "expected startup wake to materialize virtualized passive CONCORD before visibility",
    );

    const firstSummaries = getStartupSummaries();
    assert(firstSummaries.length > 0, "expected startup rule to materialize CONCORD on scene wake");

    const firstAnchorIDs = [...new Set(firstSummaries.map((summary) => summary.anchorID))].sort((a, b) => a - b);
    assert.deepStrictEqual(
      firstAnchorIDs,
      [...gateIDs].sort((a, b) => a - b),
      "startup rule should cover every stargate anchor in the target system",
    );
    assert(
      firstSummaries.every((summary) => summary.entityType === "concord"),
      "startup rule should only spawn CONCORD entities",
    );
    assert(
      firstSummaries.every((summary) => summary.allowPodKill === false),
      "startup CONCORD presence should default to no pod killing",
    );
    assert(
      firstSummaries.every((summary) => summary.transient === true),
      "passive authored startup-rule CONCORD should be runtime-only native state",
    );
    database.flushAllSync();
    assert(
      countPersistedStartupRuleShips() === 0,
      "native authored startup CONCORD must not leak into inventory items",
    );
    assert(
      countPersistedNativeStartupEntities() === 0,
      "passive authored startup CONCORD should not persist native entity rows to disk",
    );
    assert(
      countPersistedNativeStartupControllers() === 0,
      "passive authored startup CONCORD should not persist native controller rows to disk",
    );

    const firstController = npcService.getControllerByEntityID(firstSummaries[0].entityID);
    assert(firstController, "expected controller for first startup NPC");
    assert.strictEqual(firstController.behaviorOverrides.autoAggro, false);
    assert.strictEqual(firstController.behaviorOverrides.autoActivateWeapons, false);
    assert.strictEqual(firstController.behaviorOverrides.allowPodKill, false);
    assert.strictEqual(firstController.behaviorOverrides.idleAnchorOrbit, true);

    npcService.tickScene(
      scene,
      scene.getCurrentSimTimeMs() + 1_000,
    );
    const firstEntity = scene.getEntityByID(firstSummaries[0].entityID);
    assert(firstEntity, "expected first startup CONCORD entity");
    assert.strictEqual(firstEntity.mode, "ORBIT");
    assert.strictEqual(
      Number(firstEntity.targetEntityID || 0),
      Number(firstSummaries[0].anchorID || 0),
      "startup gate CONCORD should idle-orbit its gate anchor while passive",
    );

    const firstSlim = destiny.buildSlimItemDict(firstEntity);
    assert.strictEqual(
      getDictValue(firstSlim, "hostile_response_threshold"),
      -11,
      "startup CONCORD slim items should expose neutral hostile-response thresholds",
    );
    assert.strictEqual(
      getDictValue(firstSlim, "friendly_response_threshold"),
      11,
      "startup CONCORD slim items should expose neutral friendly-response thresholds",
    );

    const encodedOrbitBall = Buffer.from(
      destiny.debugDescribeEntityBall(firstEntity).encodedHex,
      "hex",
    );
    const orbitTail = encodedOrbitBall.subarray(encodedOrbitBall.length - 12);
    assert.strictEqual(
      Number(orbitTail.readBigInt64LE(0)),
      Number(firstSummaries[0].anchorID || 0),
      "orbit bootstrap state should carry the real anchor ball ID",
    );
    assert(
      Math.abs(orbitTail.readFloatLE(8) - Number(firstEntity.orbitDistance || 0)) < 1,
      "orbit bootstrap state should encode the orbit radius as a float radius tail",
    );

    const secondApplyResult = npcService.spawnStartupRulesForSystem(TEST_SYSTEM_ID);
    assert.strictEqual(secondApplyResult.success, true, secondApplyResult.errorMsg || "startup rule reapply failed");
    const secondApplySpawnedCount = secondApplyResult.data.applied.reduce(
      (sum, entry) => sum + (
        entry &&
        entry.success &&
        entry.data &&
        Array.isArray(entry.data.spawned)
          ? entry.data.spawned.length
          : 0
      ),
      0,
    );
    assert.strictEqual(
      secondApplySpawnedCount,
      0,
      "reapplying startup rules in an already-seeded scene should not duplicate anchors",
    );

    const firstEntityIDs = firstSummaries.map((summary) => summary.entityID);
    const firstEntityIDSet = new Set(firstEntityIDs);

    runtime._testing.clearScenes();
    clearControllers();

    const restartedScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(restartedScene, "expected restarted scene");
    const restartedColdVirtualizedControllers = nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)
      .filter((controller) => String(controller && controller.startupRuleID || "").trim() === STARTUP_RULE_ID);
    assert(
      restartedColdVirtualizedControllers.length > 0,
      "scene restart should recreate passive startup CONCORD as virtualized transient rows before wake",
    );
    assert.strictEqual(
      getStartupSummaries().length,
      0,
      "scene restart should stay descriptor-backed until the cold scene is explicitly woken",
    );
    const restartedWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "startup-selftest-restart-wake",
    });
    assert.strictEqual(
      restartedWakeResult.success,
      true,
      restartedWakeResult.errorMsg || "startup restart wake failed",
    );
    const restartedSummaries = getStartupSummaries();
    assert(
      restartedSummaries.length > 0,
      "scene restart should recreate passive startup NPCs from the live rule set",
    );
    assert(
      restartedSummaries.every((summary) => summary.transient === true),
      "restarted passive startup NPCs should still be runtime-only controllers",
    );
    assert.deepStrictEqual(
      [...new Set(restartedSummaries.map((summary) => summary.anchorID))].sort((a, b) => a - b),
      [...new Set(firstSummaries.map((summary) => summary.anchorID))].sort((a, b) => a - b),
      "scene restart should restore the same authored gate coverage",
    );
    const restartedEntityIDs = restartedSummaries.map((summary) => summary.entityID);
    const reusedEntityIDs = restartedEntityIDs.filter((entityID) => firstEntityIDSet.has(entityID));
    assert.deepStrictEqual(
      reusedEntityIDs,
      [],
      "scene restart should spawn fresh runtime-only native entities instead of rehydrating old rows",
    );
    database.flushAllSync();
    assert(
      countPersistedStartupRuleShips() === 0,
      "scene restart should still leave zero persisted startup ships on disk",
    );
    assert(
      countPersistedNativeStartupEntities() === 0,
      "scene restart should still leave zero native startup entities on disk",
    );
    assert(
      countPersistedNativeStartupControllers() === 0,
      "scene restart should still leave zero native startup controllers on disk",
    );

    console.log(JSON.stringify({
      ok: true,
      startupRuleID: STARTUP_RULE_ID,
      gateCount: gateIDs.length,
      spawnedEntities: firstSummaries.length,
      duplicateReapplySpawned: secondApplySpawnedCount,
      restoredEntities: restartedSummaries.length,
      reusedEntityIDs: reusedEntityIDs.length,
      runtimeOnly: true,
    }, null, 2));
  } finally {
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, null);
    config.npcAuthoredStartupEnabled = originalAuthoredStartupEnabled;
    cleanupStartupRuleShips();
    runtime._testing.clearScenes();
    clearControllers();
    database.write("npcEntities", "/", cloneValue(originalTables.npcEntities));
    database.write("npcModules", "/", cloneValue(originalTables.npcModules));
    database.write("npcCargo", "/", cloneValue(originalTables.npcCargo));
    database.write("npcRuntimeControllers", "/", cloneValue(originalTables.npcRuntimeControllers));
    database.flushAllSync();
  }
}

main();
setImmediate(() => process.exit(0));
