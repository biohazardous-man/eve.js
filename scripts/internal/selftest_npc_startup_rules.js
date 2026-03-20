const fs = require("fs");
const assert = require("assert");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const config = require(path.join(__dirname, "../../server/src/config"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
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

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function cleanupStartupRuleShips() {
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

function main() {
  const originalAuthoredStartupEnabled = config.npcAuthoredStartupEnabled;
  runtime._testing.clearScenes();
  clearControllers();
  cleanupStartupRuleShips();

  try {
    config.npcAuthoredStartupEnabled = true;
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, true);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(scene, "expected startup test scene");

    const gateIDs = worldData.getStargatesForSystem(TEST_SYSTEM_ID).map((gate) => gate.itemID);
    assert(gateIDs.length > 0, "expected stargates in startup test system");

    const firstSummaries = getStartupSummaries();
    assert(firstSummaries.length > 0, "expected startup rule to spawn CONCORD on scene create");

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
      firstSummaries.every((summary) => summary.transient === false),
      "authored startup-rule CONCORD should remain restart-persistent unless explicitly marked transient",
    );
    database.flushAllSync();
    assert(
      countPersistedStartupRuleShips() > 0,
      "authored startup-rule CONCORD should still persist to disk for restart-safe rehydration",
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

    runtime._testing.clearScenes();
    clearControllers();

    const restartedScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(restartedScene, "expected restarted scene");
    const restartedSummaries = getStartupSummaries();
    assert.strictEqual(
      restartedSummaries.length,
      firstSummaries.length,
      "scene restart should rehydrate persisted startup NPCs without changing count",
    );
    assert.deepStrictEqual(
      restartedSummaries.map((summary) => summary.entityID),
      firstEntityIDs,
      "scene restart should restore the same persisted NPC ship items",
    );

    console.log(JSON.stringify({
      ok: true,
      startupRuleID: STARTUP_RULE_ID,
      gateCount: gateIDs.length,
      spawnedEntities: firstSummaries.length,
      duplicateReapplySpawned: secondApplySpawnedCount,
      restoredEntities: restartedSummaries.length,
    }, null, 2));
  } finally {
    setStartupRuleEnabledOverride(STARTUP_RULE_ID, null);
    config.npcAuthoredStartupEnabled = originalAuthoredStartupEnabled;
    cleanupStartupRuleShips();
    clearControllers();
    runtime._testing.clearScenes();
  }
}

main();
setImmediate(() => process.exit(0));
