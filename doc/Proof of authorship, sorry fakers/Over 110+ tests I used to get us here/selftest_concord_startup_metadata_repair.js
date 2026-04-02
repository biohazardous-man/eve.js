/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const config = require(path.join(__dirname, "../../server/src/config"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const {
  DEFAULT_GATE_RULE_PREFIX,
} = require(path.join(__dirname, "../../server/src/space/npc/npcDefaultConcordRules"));
const {
  listSystemSpaceItems,
  removeInventoryItem,
  updateShipItem,
  findShipItemById,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000145;
const GENERATED_GATE_RULE_ID = `${DEFAULT_GATE_RULE_PREFIX}${TEST_SYSTEM_ID}`;

function cleanupSystemNpcShips(systemID) {
  for (const item of listSystemSpaceItems(systemID)) {
    const npcMetadata = npcService.parseNpcCustomInfo(item && item.customInfo);
    if (!npcMetadata) {
      continue;
    }

    try {
      runtime.removeDynamicEntity(systemID, item.itemID, {
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

function resetTestSystem() {
  try {
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "concord",
      removeContents: true,
    });
  } catch (error) {
    // Best-effort cleanup for selftests.
  }
  runtime._testing.clearScenes();
  clearControllers();
  cleanupSystemNpcShips(TEST_SYSTEM_ID);
}

function getGeneratedGateSummaries() {
  return npcService.getNpcOperatorSummary()
    .filter((summary) => String(summary && summary.startupRuleID || "") === GENERATED_GATE_RULE_ID)
    .sort((left, right) => left.entityID - right.entityID);
}

function main() {
  const originalAuthoredStartupEnabled = config.npcAuthoredStartupEnabled;
  const originalStartupEnabled = config.npcDefaultConcordStartupEnabled;
  const originalStationScreensEnabled = config.npcDefaultConcordStationScreensEnabled;
  resetTestSystem();

  try {
    config.npcAuthoredStartupEnabled = false;
    config.npcDefaultConcordStartupEnabled = true;
    config.npcDefaultConcordStationScreensEnabled = false;

    const firstScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(firstScene, "expected scene for generated default CONCORD metadata repair test");

    const firstSummaries = getGeneratedGateSummaries();
    assert(firstSummaries.length > 0, "expected generated default gate CONCORD to spawn");

    const targetEntityID = firstSummaries[0].entityID;
    const originalItem = findShipItemById(targetEntityID);
    const originalMetadata = npcService.parseNpcCustomInfo(
      originalItem && originalItem.customInfo,
    );
    assert(originalMetadata, "expected persisted NPC metadata on generated CONCORD ship");
    assert.strictEqual(
      originalMetadata.behaviorOverrides.idleAnchorOrbit,
      true,
      "generated default CONCORD should persist idleAnchorOrbit in custom info",
    );

    const stripResult = updateShipItem(targetEntityID, (currentItem) => {
      const parsed = npcService.parseNpcCustomInfo(currentItem && currentItem.customInfo);
      assert(parsed, "expected parsable NPC metadata while stripping idleAnchorOrbit");
      const nextOverrides = {
        ...(parsed.behaviorOverrides || {}),
      };
      delete nextOverrides.idleAnchorOrbit;
      return {
        ...currentItem,
        customInfo: JSON.stringify({
          npc: {
            ...parsed,
            behaviorOverrides: nextOverrides,
          },
        }),
      };
    });
    assert.strictEqual(stripResult.success, true, "failed to strip idleAnchorOrbit from persisted metadata");

    runtime._testing.clearScenes();
    clearControllers();

    const restartedScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(restartedScene, "expected restarted scene for metadata repair test");

    const repairedController = npcService.getControllerByEntityID(targetEntityID);
    assert(repairedController, "expected hydrated controller for repaired generated CONCORD ship");
    assert.strictEqual(
      repairedController.behaviorOverrides.idleAnchorOrbit,
      true,
      "hydrated controller should restore missing idleAnchorOrbit from current startup rule",
    );

    npcService.tickScene(
      restartedScene,
      restartedScene.getCurrentSimTimeMs() + 1_000,
    );

    const repairedEntity = restartedScene.getEntityByID(targetEntityID);
    assert(repairedEntity, "expected repaired generated CONCORD entity");
    assert.strictEqual(
      repairedEntity.mode,
      "ORBIT",
      "repaired generated CONCORD should idle-orbit after hydration",
    );

    const repairedItem = findShipItemById(targetEntityID);
    const repairedMetadata = npcService.parseNpcCustomInfo(
      repairedItem && repairedItem.customInfo,
    );
    assert(repairedMetadata, "expected repaired persisted metadata");
    assert.strictEqual(
      repairedMetadata.behaviorOverrides.idleAnchorOrbit,
      true,
      "metadata repair should write idleAnchorOrbit back to persisted custom info",
    );

    console.log(JSON.stringify({
      ok: true,
      systemID: TEST_SYSTEM_ID,
      startupRuleID: GENERATED_GATE_RULE_ID,
      repairedEntityID: targetEntityID,
    }, null, 2));
  } finally {
    config.npcAuthoredStartupEnabled = originalAuthoredStartupEnabled;
    config.npcDefaultConcordStartupEnabled = originalStartupEnabled;
    config.npcDefaultConcordStationScreensEnabled = originalStationScreensEnabled;
    resetTestSystem();
  }
}

main();
setImmediate(() => process.exit(0));
