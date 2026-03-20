const fs = require("fs");
const assert = require("assert");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const config = require(path.join(__dirname, "../../server/src/config"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const worldData = require(path.join(__dirname, "../../server/src/space/worldData"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  DEFAULT_GATE_RULE_PREFIX,
  DEFAULT_STATION_RULE_PREFIX,
} = require(path.join(__dirname, "../../server/src/space/npc/npcDefaultConcordRules"));
const {
  listSystemSpaceItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000145; // New Caldari (1.0, no authored CONCORD gate rule)
const ITEMS_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/items/data.json",
);

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

function ruleAppliesToSystem(rule, systemID) {
  const systemIDs = Array.isArray(rule && rule.systemIDs)
    ? rule.systemIDs.map((value) => Number(value || 0))
    : [];
  return systemIDs.includes(Number(systemID || 0)) || Number(rule && rule.systemID || 0) === Number(systemID || 0);
}

function listGeneratedRulesForSystem(systemID) {
  return npcService.listNpcStartupRules().filter((rule) => (
    ruleAppliesToSystem(rule, systemID) &&
    (
      String(rule && rule.startupRuleID || "").startsWith(DEFAULT_GATE_RULE_PREFIX) ||
      String(rule && rule.startupRuleID || "").startsWith(DEFAULT_STATION_RULE_PREFIX)
    )
  ));
}

function getGeneratedSummariesForSystem(systemID) {
  return npcService.getNpcOperatorSummary().filter((summary) => (
    Number(summary && summary.systemID || 0) === Number(systemID || 0) &&
    (
      String(summary && summary.startupRuleID || "").startsWith(DEFAULT_GATE_RULE_PREFIX) ||
      String(summary && summary.startupRuleID || "").startsWith(DEFAULT_STATION_RULE_PREFIX)
    )
  ));
}

function countPersistedGeneratedShipsForSystem(systemID) {
  const persistedItems = JSON.parse(fs.readFileSync(ITEMS_DATA_PATH, "utf8"));
  return Object.values(persistedItems).filter((item) => {
    const npcMetadata = npcService.parseNpcCustomInfo(item && item.customInfo);
    const startupRuleID = String(npcMetadata && npcMetadata.startupRuleID || "");
    return (
      npcMetadata &&
      Number(item && item.locationID || 0) === Number(systemID || 0) &&
      item &&
      item.spaceState &&
      Number(item.spaceState.systemID || 0) === Number(systemID || 0) &&
      (
        startupRuleID.startsWith(DEFAULT_GATE_RULE_PREFIX) ||
        startupRuleID.startsWith(DEFAULT_STATION_RULE_PREFIX)
      )
    );
  }).length;
}

function countTransientGeneratedControllers(systemID) {
  return getGeneratedSummariesForSystem(systemID).filter(
    (summary) => summary && summary.transient === true,
  ).length;
}

function sortNumeric(values) {
  return [...values].sort((left, right) => left - right);
}

function main() {
  const originalAuthoredStartupEnabled = config.npcAuthoredStartupEnabled;
  const originalStartupEnabled = config.npcDefaultConcordStartupEnabled;
  const originalStationScreensEnabled = config.npcDefaultConcordStationScreensEnabled;
  resetTestSystem();

  try {
    const gateIDs = worldData.getStargatesForSystem(TEST_SYSTEM_ID).map((gate) => gate.itemID);
    const stationIDs = worldData.getStationsForSystem(TEST_SYSTEM_ID).map((station) => station.stationID);
    assert(gateIDs.length > 0, "expected stargates in default CONCORD startup test system");
    assert(stationIDs.length > 0, "expected stations in default CONCORD startup test system");

    const generatedGateRuleID = `${DEFAULT_GATE_RULE_PREFIX}${TEST_SYSTEM_ID}`;
    const generatedStationRuleID = `${DEFAULT_STATION_RULE_PREFIX}${TEST_SYSTEM_ID}`;

    config.npcAuthoredStartupEnabled = false;
    config.npcDefaultConcordStartupEnabled = true;
    config.npcDefaultConcordStationScreensEnabled = true;

    let generatedRules = listGeneratedRulesForSystem(TEST_SYSTEM_ID);
    assert(
      generatedRules.some((rule) => rule.startupRuleID === generatedGateRuleID),
      "default CONCORD config should generate a gate startup rule in a high-sec system without authored gate coverage",
    );
    assert(
      generatedRules.some((rule) => rule.startupRuleID === generatedStationRuleID),
      "default CONCORD config should generate a station startup rule when station screens are enabled",
    );
    assert(
      npcService.listNpcStartupRules().some((rule) => rule.startupRuleID === `${DEFAULT_GATE_RULE_PREFIX}30000142`),
      "disabled/authored-off Jita gate coverage should not suppress generated default gate CONCORD",
    );

    const gateState = npcService.getGateOperatorState(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
    assert.strictEqual(gateState.success, true);
    assert.strictEqual(gateState.data.source, "generated");
    assert.strictEqual(gateState.data.enabled, true);
    assert(
      gateState.data.startupRuleIDs.includes(generatedGateRuleID),
      "generated gate coverage should surface through the same gate operator state path",
    );

    const firstScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(firstScene, "expected scene for generated CONCORD startup test");
    let generatedSummaries = getGeneratedSummariesForSystem(TEST_SYSTEM_ID);
    const gateSummaries = generatedSummaries.filter(
      (summary) => summary.startupRuleID === generatedGateRuleID,
    );
    const stationSummaries = generatedSummaries.filter(
      (summary) => summary.startupRuleID === generatedStationRuleID,
    );
    assert(gateSummaries.length > 0, "generated gate CONCORD should spawn on scene create");
    assert(stationSummaries.length > 0, "generated station CONCORD should spawn on scene create");
    assert.deepStrictEqual(
      sortNumeric([...new Set(gateSummaries.map((summary) => summary.anchorID))]),
      sortNumeric(gateIDs),
      "generated gate coverage should cover every stargate anchor in the target system",
    );
    assert.deepStrictEqual(
      sortNumeric([...new Set(stationSummaries.map((summary) => summary.anchorID))]),
      sortNumeric(stationIDs),
      "generated station screens should cover every station anchor in the target system",
    );
    assert(
      generatedSummaries.every((summary) => summary.entityType === "concord"),
      "generated startup rules should only spawn CONCORD entities",
    );
    assert(
      generatedSummaries.every((summary) => summary.allowPodKill === false),
      "default generated CONCORD presence should never pod-kill",
    );

    npcService.tickScene(
      firstScene,
      firstScene.getCurrentSimTimeMs() + 1_000,
    );

    const firstGateController = npcService.getControllerByEntityID(gateSummaries[0].entityID);
    const firstGateEntity = firstScene.getEntityByID(gateSummaries[0].entityID);
    assert(firstGateController, "expected controller for generated gate CONCORD");
    assert(firstGateEntity, "expected generated gate CONCORD entity");
    assert.strictEqual(firstGateController.behaviorOverrides.idleAnchorOrbit, true);
    assert.strictEqual(firstGateEntity.mode, "ORBIT");
    assert.strictEqual(
      Number(firstGateEntity.targetEntityID || 0),
      Number(gateSummaries[0].anchorID || 0),
      "generated passive gate CONCORD should idle-orbit its gate anchor",
    );

    const firstStationController = npcService.getControllerByEntityID(stationSummaries[0].entityID);
    const firstStationEntity = firstScene.getEntityByID(stationSummaries[0].entityID);
    assert(firstStationController, "expected controller for generated station CONCORD");
    assert(firstStationEntity, "expected generated station CONCORD entity");
    assert.strictEqual(firstStationController.behaviorOverrides.idleAnchorOrbit, true);
    assert.strictEqual(firstStationEntity.mode, "ORBIT");
    assert.strictEqual(
      Number(firstStationEntity.targetEntityID || 0),
      Number(stationSummaries[0].anchorID || 0),
      "generated passive station CONCORD should idle-orbit its station anchor",
    );

    database.flushAllSync();
    assert.strictEqual(
      countPersistedGeneratedShipsForSystem(TEST_SYSTEM_ID),
      0,
      "generated default CONCORD should stay transient and avoid persisting startup ships to disk",
    );
    assert.strictEqual(
      countTransientGeneratedControllers(TEST_SYSTEM_ID),
      generatedSummaries.length,
      "generated default CONCORD summaries should report transient ambient controllers",
    );

    runtime._testing.clearScenes();
    clearControllers();
    config.npcDefaultConcordStartupEnabled = false;
    config.npcDefaultConcordStationScreensEnabled = false;

    const cleanupScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(cleanupScene, "expected scene for stale generated CONCORD cleanup test");
    database.flushAllSync();
    assert.strictEqual(
      countPersistedGeneratedShipsForSystem(TEST_SYSTEM_ID),
      0,
      "disabling generated default CONCORD should leave no persisted startup ships behind",
    );
    assert.strictEqual(
      getGeneratedSummariesForSystem(TEST_SYSTEM_ID).length,
      0,
      "stale generated CONCORD should not rehydrate controllers after the feature is turned off",
    );
    assert.strictEqual(
      cleanupScene.getDynamicEntities().length,
      0,
      "cleanup should leave the test system without generated CONCORD runtime ships after restart",
    );

    resetTestSystem();
    config.npcDefaultConcordStartupEnabled = true;
    config.npcDefaultConcordStationScreensEnabled = false;
    generatedRules = listGeneratedRulesForSystem(TEST_SYSTEM_ID);
    assert.deepStrictEqual(
      generatedRules.map((rule) => rule.startupRuleID),
      [generatedGateRuleID],
      "disabling station screens should leave only the generated gate rule",
    );

    const gateOnlyScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(gateOnlyScene, "expected scene for gate-only generated CONCORD test");
    generatedSummaries = getGeneratedSummariesForSystem(TEST_SYSTEM_ID);
    assert(
      generatedSummaries.some((summary) => summary.startupRuleID === generatedGateRuleID),
      "gate-only generated CONCORD should still seed gate presence",
    );
    assert.strictEqual(
      generatedSummaries.some((summary) => summary.startupRuleID === generatedStationRuleID),
      false,
      "station screens should not spawn when that config flag is disabled",
    );
    database.flushAllSync();
    assert.strictEqual(
      countPersistedGeneratedShipsForSystem(TEST_SYSTEM_ID),
      0,
      "gate-only generated CONCORD should remain transient and avoid disk persistence",
    );

    resetTestSystem();
    config.npcDefaultConcordStartupEnabled = false;
    config.npcDefaultConcordStationScreensEnabled = true;
    assert.deepStrictEqual(
      listGeneratedRulesForSystem(TEST_SYSTEM_ID),
      [],
      "disabling default CONCORD startup should remove generated rules entirely",
    );

    const disabledScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(disabledScene, "expected scene for disabled generated CONCORD test");
    assert.strictEqual(
      getGeneratedSummariesForSystem(TEST_SYSTEM_ID).length,
      0,
      "generated CONCORD should not spawn when the default startup config is off",
    );

    console.log(JSON.stringify({
      ok: true,
      systemID: TEST_SYSTEM_ID,
      gateCount: gateIDs.length,
      stationCount: stationIDs.length,
      generatedGateRuleID,
      generatedStationRuleID,
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
