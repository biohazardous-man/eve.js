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

const TEST_SYSTEM_ID = 30000001;
const STARTUP_RULE_ID = "tanoo_blood_gate_ambush_startup";
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

function cleanupStartupRuleShips() {
  try {
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "npc",
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
  }
}

function getStartupSummaries() {
  return npcService.getNpcOperatorSummary()
    .filter((summary) => summary.startupRuleID === STARTUP_RULE_ID)
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
  runtime._testing.clearScenes();
  clearControllers();
  cleanupStartupRuleShips();
  runtime._testing.clearScenes();
  clearControllers();

  try {
    config.npcAuthoredStartupEnabled = true;
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, true);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(scene, "expected pirate startup test scene");

    const gateIDs = worldData.getStargatesForSystem(TEST_SYSTEM_ID).map((gate) => gate.itemID);
    assert(gateIDs.length > 0, "expected stargates in pirate startup test system");

    const coldControllers = nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)
      .filter((controller) => String(controller && controller.startupRuleID || "").trim() === STARTUP_RULE_ID);
    assert(
      coldControllers.length > 0,
      "expected pirate startup rule to seed transient native controller rows on cold scene create",
    );
    assert(
      getStartupSummaries().length === 0,
      "cold scene create should not register live pirate startup controllers before wake",
    );

    const wakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "selftest-pirate-startup",
    });
    assert(wakeResult.success, wakeResult.errorMsg || "expected pirate startup wake to succeed");

    const firstSummaries = getStartupSummaries();
    assert(firstSummaries.length > 0, "expected pirate startup rule to materialize gate rats on wake");
    assert(
      firstSummaries.every((summary) => summary.entityType === "npc"),
      "pirate startup rule should only spawn pirate NPC entities",
    );
    assert(
      firstSummaries.every((summary) => summary.transient === true),
      "pirate startup rule NPCs should now be runtime-only native controllers",
    );
    assert.deepStrictEqual(
      [...new Set(firstSummaries.map((summary) => summary.anchorID))].sort((a, b) => a - b),
      [...gateIDs].sort((a, b) => a - b),
      "pirate startup rule should cover every stargate anchor in the target system",
    );

    database.flushAllSync();
    assert.strictEqual(
      countPersistedStartupRuleShips(),
      0,
      "pirate startup rules should no longer persist synthetic startup ships to items",
    );
    assert.strictEqual(
      countPersistedNativeStartupEntities(),
      0,
      "pirate startup rules should stay runtime-only in the native entity store",
    );
    assert.strictEqual(
      countPersistedNativeStartupControllers(),
      0,
      "pirate startup rules should stay runtime-only in the native controller store",
    );

    const firstEntityIDs = new Set(firstSummaries.map((summary) => summary.entityID));
    runtime._testing.clearScenes();
    clearControllers();

    const restartedScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(restartedScene, "expected restarted pirate startup scene");
    assert.strictEqual(
      getStartupSummaries().length,
      0,
      "scene restart should keep pirate startup controllers virtualized until wake",
    );
    const restartWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "selftest-pirate-startup-restart",
    });
    assert(
      restartWakeResult.success,
      restartWakeResult.errorMsg || "expected pirate startup restart wake to succeed",
    );
    const restartedSummaries = getStartupSummaries();
    assert(
      restartedSummaries.length > 0,
      "scene restart should recreate pirate startup NPCs from the live rule set",
    );
    assert(
      restartedSummaries.every((summary) => summary.transient === true),
      "restarted pirate startup NPCs should still be runtime-only controllers",
    );
    assert.deepStrictEqual(
      restartedSummaries.filter((summary) => firstEntityIDs.has(summary.entityID)),
      [],
      "scene restart should spawn fresh native pirate startup entities instead of rehydrating old rows",
    );

    database.flushAllSync();
    assert.strictEqual(
      countPersistedStartupRuleShips(),
      0,
      "scene restart should still leave zero persisted pirate startup ships on disk",
    );
    assert.strictEqual(
      countPersistedNativeStartupEntities(),
      0,
      "scene restart should still leave zero native pirate startup entities on disk",
    );
    assert.strictEqual(
      countPersistedNativeStartupControllers(),
      0,
      "scene restart should still leave zero native pirate startup controllers on disk",
    );

    console.log(JSON.stringify({
      ok: true,
      startupRuleID: STARTUP_RULE_ID,
      gateCount: gateIDs.length,
      spawnedEntities: firstSummaries.length,
      restoredEntities: restartedSummaries.length,
      runtimeOnly: true,
    }, null, 2));
  } finally {
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, null);
    config.npcAuthoredStartupEnabled = originalAuthoredStartupEnabled;
    cleanupStartupRuleShips();
    runtime._testing.clearScenes();
    clearControllers();
  }
}

main();
setImmediate(() => process.exit(0));
