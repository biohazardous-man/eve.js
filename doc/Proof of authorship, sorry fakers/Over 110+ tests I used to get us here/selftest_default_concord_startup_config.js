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
const worldData = require(path.join(__dirname, "../../server/src/space/worldData"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const nativeNpcStore = require(path.join(__dirname, "../../server/src/space/npc/nativeNpcStore"));
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
const NATIVE_ENTITY_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcEntities/data.json",
);
const NATIVE_CONTROLLER_DATA_PATH = path.join(
  __dirname,
  "../../server/src/newDatabase/data/npcRuntimeControllers/data.json",
);

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  for (const controller of nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)) {
    const startupRuleID = String(controller && controller.startupRuleID || "");
    if (
      !startupRuleID.startsWith(DEFAULT_GATE_RULE_PREFIX) &&
      !startupRuleID.startsWith(DEFAULT_STATION_RULE_PREFIX)
    ) {
      continue;
    }
    try {
      nativeNpcStore.removeNativeEntityCascade(controller.entityID);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
  }
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

function countPersistedGeneratedNativeEntities(systemID) {
  const persistedEntities = JSON.parse(fs.readFileSync(NATIVE_ENTITY_DATA_PATH, "utf8"));
  return Object.values(persistedEntities && persistedEntities.entities || {}).filter((entity) => {
    const startupRuleID = String(entity && entity.startupRuleID || "");
    return (
      Number(entity && entity.systemID || 0) === Number(systemID || 0) &&
      (
        startupRuleID.startsWith(DEFAULT_GATE_RULE_PREFIX) ||
        startupRuleID.startsWith(DEFAULT_STATION_RULE_PREFIX)
      )
    );
  }).length;
}

function countPersistedGeneratedNativeControllers(systemID) {
  const persistedControllers = JSON.parse(fs.readFileSync(NATIVE_CONTROLLER_DATA_PATH, "utf8"));
  return Object.values(persistedControllers && persistedControllers.controllers || {}).filter((controller) => {
    const startupRuleID = String(controller && controller.startupRuleID || "");
    return (
      Number(controller && controller.systemID || 0) === Number(systemID || 0) &&
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

function advanceSceneByMs(scene, totalMs, steps = 1) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const stepMs = Math.max(1, Math.trunc(totalMs / Math.max(1, steps)));
  for (let index = 0; index < steps; index += 1) {
    wallclockNow += stepMs;
    scene.tick(wallclockNow);
  }
}

function main() {
  const originalAuthoredStartupEnabled = config.npcAuthoredStartupEnabled;
  const originalStartupEnabled = config.npcDefaultConcordStartupEnabled;
  const originalGateAutoAggroNpcsEnabled = config.npcDefaultConcordGateAutoAggroNpcsEnabled;
  const originalStationScreensEnabled = config.npcDefaultConcordStationScreensEnabled;
  const originalTables = {
    npcEntities: database.read("npcEntities", "/").success ? cloneValue(database.read("npcEntities", "/").data) : {},
    npcModules: database.read("npcModules", "/").success ? cloneValue(database.read("npcModules", "/").data) : {},
    npcCargo: database.read("npcCargo", "/").success ? cloneValue(database.read("npcCargo", "/").data) : {},
    npcRuntimeControllers: database.read("npcRuntimeControllers", "/").success
      ? cloneValue(database.read("npcRuntimeControllers", "/").data)
      : {},
  };
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
    config.npcDefaultConcordGateAutoAggroNpcsEnabled = false;
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
    const coldGeneratedControllers = nativeNpcStore.listNativeControllersForSystem(TEST_SYSTEM_ID)
      .filter((controller) => {
        const startupRuleID = String(controller && controller.startupRuleID || "");
        return (
          startupRuleID.startsWith(DEFAULT_GATE_RULE_PREFIX) ||
          startupRuleID.startsWith(DEFAULT_STATION_RULE_PREFIX)
        );
      });
    assert(
      coldGeneratedControllers.length > 0,
      "generated default CONCORD should be virtualized into transient native rows on cold scene create",
    );
    let generatedSummaries = getGeneratedSummariesForSystem(TEST_SYSTEM_ID);
    assert.strictEqual(
      generatedSummaries.length,
      0,
      "generated default CONCORD should remain virtualized until the scene wake path materializes it",
    );
    const firstWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "default-concord-startup-selftest",
    });
    assert.strictEqual(firstWakeResult.success, true, firstWakeResult.errorMsg || "default CONCORD wake failed");
    generatedSummaries = getGeneratedSummariesForSystem(TEST_SYSTEM_ID);
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
      countPersistedGeneratedNativeEntities(TEST_SYSTEM_ID),
      0,
      "generated default CONCORD should stay transient in the native NPC entity store too",
    );
    assert.strictEqual(
      countPersistedGeneratedNativeControllers(TEST_SYSTEM_ID),
      0,
      "generated default CONCORD should stay transient in the native NPC controller store too",
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
    config.npcDefaultConcordGateAutoAggroNpcsEnabled = false;
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
    assert.strictEqual(
      generatedSummaries.length,
      0,
      "gate-only generated CONCORD should stay virtualized until wake",
    );
    const gateOnlyWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "default-concord-gate-only-selftest",
    });
    assert.strictEqual(
      gateOnlyWakeResult.success,
      true,
      gateOnlyWakeResult.errorMsg || "gate-only default CONCORD wake failed",
    );
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
    config.npcDefaultConcordStartupEnabled = true;
    config.npcDefaultConcordGateAutoAggroNpcsEnabled = true;
    config.npcDefaultConcordStationScreensEnabled = true;
    generatedRules = listGeneratedRulesForSystem(TEST_SYSTEM_ID);
    const aggressiveGateRule = generatedRules.find(
      (rule) => rule.startupRuleID === generatedGateRuleID,
    );
    const passiveStationRule = generatedRules.find(
      (rule) => rule.startupRuleID === generatedStationRuleID,
    );
    assert(aggressiveGateRule, "expected generated aggressive gate CONCORD rule");
    assert(passiveStationRule, "expected generated passive station CONCORD rule");
    assert.strictEqual(aggressiveGateRule.behaviorOverrides.autoAggro, true);
    assert.deepStrictEqual(
      aggressiveGateRule.behaviorOverrides.autoAggroTargetClasses,
      ["npc"],
      "gate CONCORD NPC auto-aggro config should target nearby NPC ships",
    );
    assert.strictEqual(aggressiveGateRule.behaviorOverrides.autoActivateWeapons, true);
    assert.strictEqual(passiveStationRule.behaviorOverrides.autoAggro, false);
    assert.strictEqual(passiveStationRule.behaviorOverrides.autoActivateWeapons, false);

    const aggressiveScene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(aggressiveScene, "expected scene for aggressive generated CONCORD test");
    const aggressiveWakeResult = runtime.wakeSceneForImmediateUse(TEST_SYSTEM_ID, {
      reason: "default-concord-gate-auto-aggro-selftest",
    });
    assert.strictEqual(
      aggressiveWakeResult.success,
      true,
      aggressiveWakeResult.errorMsg || "aggressive default CONCORD wake failed",
    );
    generatedSummaries = getGeneratedSummariesForSystem(TEST_SYSTEM_ID);
    const aggressiveGateSummaries = generatedSummaries.filter(
      (summary) => summary.startupRuleID === generatedGateRuleID,
    );
    assert(
      aggressiveGateSummaries.length > 0,
      "aggressive generated gate CONCORD should materialize on wake",
    );
    const aggressiveGateAnchorID = Number(aggressiveGateSummaries[0].anchorID || 0);
    const aggressiveGateAnchor = aggressiveScene.staticEntities.find(
      (entity) => Number(entity && entity.itemID || 0) === aggressiveGateAnchorID,
    );
    assert(aggressiveGateAnchor, "expected gate anchor entity for aggressive CONCORD test");

    const ratSpawn = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      amount: 1,
      profileQuery: "generic_hostile",
      preferPools: false,
      entityType: "npc",
      preferredTargetID: 0,
      anchorDescriptor: {
        kind: "coordinates",
        position: cloneValue(aggressiveGateAnchor.position),
        direction: { x: 1, y: 0, z: 0 },
        name: "Generated Gate CONCORD Auto Aggro Test",
      },
      spawnDistanceMeters: 1_500,
      spreadMeters: 0,
    });
    assert.strictEqual(ratSpawn.success, true, ratSpawn.errorMsg || "gate auto-aggro rat spawn failed");
    const ratEntity = ratSpawn.data.spawned[0].entity;
    assert(ratEntity, "expected live rat entity for gate auto-aggro test");

    advanceSceneByMs(aggressiveScene, 12_000, 24);
    const aggressiveGateControllers = aggressiveGateSummaries
      .map((summary) => npcService.getControllerByEntityID(summary.entityID))
      .filter(Boolean);
    assert(
      aggressiveGateControllers.some((controller) => Number(controller.currentTargetID || 0) === Number(ratEntity.itemID || 0)),
      "generated gate CONCORD should lock and attack a nearby NPC when gate auto-aggro is enabled",
    );
    assert(
      aggressiveGateControllers.some((controller) => Number(controller.currentTargetID || 0) > 0),
      "generated gate CONCORD should actively acquire targets when gate auto-aggro is enabled",
    );

    resetTestSystem();
    config.npcDefaultConcordStartupEnabled = false;
    config.npcDefaultConcordGateAutoAggroNpcsEnabled = false;
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
    config.npcDefaultConcordGateAutoAggroNpcsEnabled = originalGateAutoAggroNpcsEnabled;
    config.npcDefaultConcordStationScreensEnabled = originalStationScreensEnabled;
    database.write("npcEntities", "/", cloneValue(originalTables.npcEntities));
    database.write("npcModules", "/", cloneValue(originalTables.npcModules));
    database.write("npcCargo", "/", cloneValue(originalTables.npcCargo));
    database.write("npcRuntimeControllers", "/", cloneValue(originalTables.npcRuntimeControllers));
    resetTestSystem();
    database.flushAllSync();
  }
}

main();
setImmediate(() => process.exit(0));
