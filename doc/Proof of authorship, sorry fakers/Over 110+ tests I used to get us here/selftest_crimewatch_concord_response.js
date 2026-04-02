/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const config = require(path.join(__dirname, "../../server/src/config"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const CrimewatchService = require(path.join(__dirname, "../../server/src/services/security/crimewatchService"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const TEST_CAPSULE_TYPE_ID = 670;
const ATTACKER_CLIENT_ID = 968001;
const ATTACKER_CHARACTER_ID = 978001;
const VICTIM_CLIENT_ID = 968002;
const VICTIM_CHARACTER_ID = 978002;
const TEST_POSITION = Object.freeze({
  x: -107303362560,
  y: -18744975360,
  z: 436489052160,
});
const TABLE_FILE_PATHS = Object.freeze({
  characters: path.join(__dirname, "../../server/src/newDatabase/data/characters/data.json"),
  items: path.join(__dirname, "../../server/src/newDatabase/data/items/data.json"),
  skills: path.join(__dirname, "../../server/src/newDatabase/data/skills/data.json"),
  npcEntities: path.join(__dirname, "../../server/src/newDatabase/data/npcEntities/data.json"),
  npcModules: path.join(__dirname, "../../server/src/newDatabase/data/npcModules/data.json"),
  npcCargo: path.join(__dirname, "../../server/src/newDatabase/data/npcCargo/data.json"),
  npcRuntimeControllers: path.join(__dirname, "../../server/src/newDatabase/data/npcRuntimeControllers/data.json"),
});

function readDiskJson(table) {
  return JSON.parse(fs.readFileSync(TABLE_FILE_PATHS[table], "utf8"));
}

function snapshotPersistedNpcTables() {
  return {
    characters: Object.keys(readDiskJson("characters") || {}).length,
    items: Object.keys(readDiskJson("items") || {}).length,
    skills: Object.keys(readDiskJson("skills") || {}).length,
    npcEntities: Object.keys((readDiskJson("npcEntities") || {}).entities || {}).length,
    npcModules: Object.keys((readDiskJson("npcModules") || {}).modules || {}).length,
    npcCargo: Object.keys((readDiskJson("npcCargo") || {}).cargo || {}).length,
    npcRuntimeControllers: Object.keys((readDiskJson("npcRuntimeControllers") || {}).controllers || {}).length,
  };
}

function createFakeSession(clientID, characterID, systemID, position, direction) {
  const notifications = [];
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachReadySession(session) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
}

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

function collectDestinyPayloads(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => ({
        stamp: entry[0],
        name: entry[1][0],
        args: Array.isArray(entry[1] && entry[1][1])
          ? entry[1][1]
          : entry[1].slice(1),
      }),
    ),
  );
}

function extractDestinyEntries(notifications) {
  return collectDestinyPayloads(notifications);
}

function collectEntityIDsForPayloadName(notifications, payloadName) {
  return collectDestinyPayloads(notifications)
    .filter((entry) => entry.name === payloadName)
    .map((entry) => Number(entry.args && entry.args[0] || 0))
    .filter((entityID) => entityID > 0);
}

function advanceSceneByMs(scene, totalMs, steps = 1) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const stepMs = Math.max(1, Math.trunc(totalMs / Math.max(1, steps)));
  for (let index = 0; index < steps; index += 1) {
    wallclockNow += stepMs;
    scene.tick(wallclockNow);
  }
}

function advanceSceneUntil(scene, maxDurationMs, stepMs, predicate) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const maxSteps = Math.max(1, Math.ceil(maxDurationMs / Math.max(1, stepMs)));
  for (let index = 0; index < maxSteps; index += 1) {
    wallclockNow += Math.max(1, stepMs);
    scene.tick(wallclockNow);
    if (predicate()) {
      return true;
    }
  }
  return false;
}

function getVisibleDynamicEntityIDs(session) {
  return session &&
    session._space &&
    session._space.visibleDynamicEntityIDs instanceof Set
    ? session._space.visibleDynamicEntityIDs
    : new Set();
}

function main() {
  const originalPodKillEnabled = config.crimewatchConcordPodKillEnabled;
  config.crimewatchConcordPodKillEnabled = false;
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
  });

  let attackerSession = null;
  let victimSession = null;

  try {
    const persistedBefore = snapshotPersistedNpcTables();
    attackerSession = createFakeSession(
      ATTACKER_CLIENT_ID,
      ATTACKER_CHARACTER_ID,
      TEST_SYSTEM_ID,
      {
        x: TEST_POSITION.x,
        y: TEST_POSITION.y,
        z: TEST_POSITION.z,
      },
      { x: 1, y: 0, z: 0 },
    );
    victimSession = createFakeSession(
      VICTIM_CLIENT_ID,
      VICTIM_CHARACTER_ID,
      TEST_SYSTEM_ID,
      {
        x: TEST_POSITION.x + 4_000,
        y: TEST_POSITION.y,
        z: TEST_POSITION.z,
      },
      { x: -1, y: 0, z: 0 },
    );
    attachReadySession(attackerSession);
    attachReadySession(victimSession);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const attackerEntity = scene.getEntityByID(attackerSession._space.shipID);
    const victimEntity = scene.getEntityByID(victimSession._space.shipID);
    assert(attackerEntity, "expected attacker entity");
    assert(victimEntity, "expected victim entity");

    const now = scene.getCurrentSimTimeMs();
    const aggressionResult = crimewatchState.recordHighSecCriminalAggression(
      scene,
      attackerEntity,
      victimEntity,
      now,
    );
    assert.strictEqual(
      aggressionResult.success,
      true,
      aggressionResult.errorMsg || "crimewatch aggression record failed",
    );
    assert.strictEqual(
      aggressionResult.data.applied,
      true,
      "high-sec player aggression should create a criminal flag",
    );
    assert.strictEqual(
      crimewatchState.isCriminallyFlagged(attackerSession.characterID, now),
      true,
      "attacker should have an active criminal timer",
    );
    const blockedWarpResult = runtime.warpToPoint(attackerSession, {
      x: TEST_POSITION.x + 250_000,
      y: TEST_POSITION.y,
      z: TEST_POSITION.z,
    });
    assert.strictEqual(
      blockedWarpResult && blockedWarpResult.errorMsg,
      "CRIMINAL_TIMER_ACTIVE",
      "criminal attackers should not be able to initiate warp",
    );

    const crimewatchService = new CrimewatchService();
    const clientStates = crimewatchService.Handle_GetClientStates([], attackerSession, null);
    const combatTimers = Array.isArray(clientStates) ? clientStates[0] : null;
    const flaggedCharacters = Array.isArray(clientStates) ? clientStates[2] : null;
    assert(Array.isArray(combatTimers), "expected crimewatch timers tuple");
    assert.strictEqual(
      Array.isArray(combatTimers[0]) && combatTimers[0][0],
      crimewatchState.WEAPONS_TIMER_STATE_TIMER,
      "weapon timer should be active after illegal aggression",
    );
    assert.strictEqual(
      Array.isArray(combatTimers[1]) && combatTimers[1][0],
      crimewatchState.PVP_TIMER_STATE_TIMER,
      "PvP timer should be active after illegal aggression",
    );
    assert.strictEqual(
      Array.isArray(combatTimers[3]) && combatTimers[3][0],
      crimewatchState.CRIMINAL_TIMER_STATE_TIMER_CRIMINAL,
      "criminal timer should be active after illegal aggression",
    );
    assert(
      flaggedCharacters &&
      flaggedCharacters[0] &&
      Array.isArray(flaggedCharacters[0].items) &&
      flaggedCharacters[0].items.includes(attackerSession.characterID),
      "crimewatch flaggedCharacters should include the criminal attacker",
    );

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    assert(responseDelayMs > 0, "expected a high-sec CONCORD response delay");

    attackerSession.notifications.length = 0;
    victimSession.notifications.length = 0;
    advanceSceneByMs(
      scene,
      Math.max(0, responseDelayMs - 250),
      Math.max(1, Math.trunc(Math.max(0, responseDelayMs - 250) / 250)),
    );
    assert.strictEqual(
      npcService.getNpcOperatorSummary().filter((summary) => (
        summary.systemID === TEST_SYSTEM_ID &&
        summary.entityType === "concord"
      )).length,
      0,
      "CONCORD should not spawn before the response delay elapses",
    );

    attackerSession.notifications.length = 0;
    victimSession.notifications.length = 0;
    advanceSceneByMs(
      scene,
      500,
      2,
    );

    const expectedResponderCount = crimewatchState.getConcordResponseShipCountForSystem(
      scene.system,
    );
    const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert.strictEqual(
      concordSummaries.length,
      expectedResponderCount,
      `CONCORD responders should spawn as the expected ${expectedResponderCount}-ship high-sec response wing`,
    );
    const concordEntities = concordSummaries
      .map((summary) => scene.getEntityByID(summary.entityID))
      .filter(Boolean);
    assert.strictEqual(
      concordEntities.length,
      expectedResponderCount,
      "Expected the full live CONCORD response wing after response spawn",
    );
    assert(
      concordEntities.every((entity) => entity.transient === true),
      "Crimewatch response CONCORD should be transient",
    );
    assert(
      concordEntities.every((entity) => entity.persistSpaceState !== true),
      "Crimewatch response CONCORD should not persist space state",
    );
    assert(
      concordEntities.every((entity) => entity.nativeNpc === true),
      "Crimewatch response CONCORD should now spawn as native NPC entities",
    );
    assert(
      concordEntities.every((entity) => Number(entity.pilotCharacterID || 0) === 0),
      "Crimewatch response CONCORD should not allocate synthetic pilot characters",
    );
    assert(
      concordEntities.every((entity) =>
        Array.isArray(entity.fittedItems) &&
        entity.fittedItems.some((moduleItem) => (
          Number(moduleItem && moduleItem.typeID || 0) > 0
        ))
      ),
      "Crimewatch response CONCORD should spawn with authored fitted weapon modules",
    );
    assert(
      concordEntities.some((entity) =>
        Array.isArray(entity.fittedItems) &&
        entity.fittedItems.some((moduleItem) => (
          [3559, 3561].includes(Number(moduleItem && moduleItem.typeID || 0))
        ))
      ),
      "Crimewatch response CONCORD should include dedicated heavy CONCORD laser hardware on the heavier hulls",
    );
    assert(
      concordSummaries.every((summary) => (
        summary.manualOrderType === "attack"
      )),
      "Freshly spawned CONCORD responders should inherit the shared attack order before grouped warp completion",
    );
    assert(
      concordEntities.every((entity) =>
        entity &&
        entity.warpState &&
        entity.warpState.origin &&
        entity.warpState.targetPoint &&
        (
          (
            ((Number(entity.warpState.targetPoint.x || 0) - Number(entity.warpState.origin.x || 0)) ** 2) +
            ((Number(entity.warpState.targetPoint.y || 0) - Number(entity.warpState.origin.y || 0)) ** 2) +
            ((Number(entity.warpState.targetPoint.z || 0) - Number(entity.warpState.origin.z || 0)) ** 2)
          ) >= (500_000 ** 2)
        )
      ),
      "Crimewatch responders should use a real long-distance warp profile instead of a same-spot materialize path",
    );
    database.flushAllSync();
    const persistedAfterSpawn = snapshotPersistedNpcTables();
    assert.deepStrictEqual(
      persistedAfterSpawn,
      persistedBefore,
      "Transient Crimewatch response CONCORD should not add persisted player or native NPC rows to disk",
    );
    const responderEntityIDs = concordEntities.map((entity) => entity.itemID);
    const responderControllers = responderEntityIDs
      .map((entityID) => npcService.getControllerByEntityID(entityID))
      .filter(Boolean);
    assert.strictEqual(
      responderControllers.length,
      responderEntityIDs.length,
      "Expected every spawned CONCORD responder to have a live controller",
    );
    assert(
      responderControllers.every((controller) =>
        Number(controller.nextThinkAtMs || 0) > scene.getCurrentSimTimeMs() + 1_000
      ),
      "Grouped CONCORD ingress should defer controller wake until after the shared warp-in finishes",
    );
    assert(
      responderControllers.every((controller) =>
        Number(controller.nextThinkAtMs || 0) <= scene.getCurrentSimTimeMs() + 5_500
      ),
      "Grouped CONCORD ingress should not keep responders in server-side warp long after the client-side EntityWarpIn window ends",
    );
    assert(
      concordEntities.every((entity) =>
        !(entity.activeModuleEffects instanceof Map) ||
        entity.activeModuleEffects.size === 0
      ),
      "Responders should not start propulsion or weapon effects in the same tick they spawn",
    );
    assert(
      responderEntityIDs.every((entityID) => !getVisibleDynamicEntityIDs(attackerSession).has(entityID)),
      "Pilot should not acquire Crimewatch responders at the far response origin spawn",
    );
    assert(
      responderEntityIDs.every((entityID) => !getVisibleDynamicEntityIDs(victimSession).has(entityID)),
      "Observer should not acquire Crimewatch responders at the far response origin spawn",
    );

    advanceSceneByMs(scene, 1_000, 4);
    assert(
      responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          responderEntity.mode === "WARP" &&
          (
            !(responderEntity.activeModuleEffects instanceof Map) ||
            responderEntity.activeModuleEffects.size === 0
          );
      }),
      "CONCORD responders should stay in visible ingress instead of immediately chasing during the first second after spawn",
    );

    const attackerFirstAcquireModes = new Map();
    const victimFirstAcquireModes = new Map();
    let acquiredAllResponders = false;
    let acquireWallclockNow = scene.getCurrentWallclockMs();
    for (let index = 0; index < 80; index += 1) {
      acquireWallclockNow += 250;
      scene.tick(acquireWallclockNow);
      for (const responderEntityID of responderEntityIDs) {
        const responderEntity = scene.getEntityByID(responderEntityID);
        if (
          !attackerFirstAcquireModes.has(responderEntityID) &&
          getVisibleDynamicEntityIDs(attackerSession).has(responderEntityID)
        ) {
          attackerFirstAcquireModes.set(
            responderEntityID,
            responderEntity ? responderEntity.mode : null,
          );
        }
        if (
          !victimFirstAcquireModes.has(responderEntityID) &&
          getVisibleDynamicEntityIDs(victimSession).has(responderEntityID)
        ) {
          victimFirstAcquireModes.set(
            responderEntityID,
            responderEntity ? responderEntity.mode : null,
          );
        }
      }
      if (
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(attackerSession).has(entityID)) &&
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(victimSession).has(entityID))
      ) {
        acquiredAllResponders = true;
        break;
      }
    }
    assert(
      acquiredAllResponders,
      "Both pilot and observer should eventually acquire all CONCORD responders during warp-in",
    );
    const responderSummariesDuringIngress = npcService.getNpcOperatorSummary().filter((summary) =>
      responderEntityIDs.includes(summary.entityID)
    );
    assert(
      responderSummariesDuringIngress.every((summary) =>
        summary.manualOrderType === "attack" &&
        Number(summary.currentTargetID) === Number(attackerEntity.itemID)
      ),
      "Crimewatch responders should carry their shared attack order through ingress instead of waking blank after warp",
    );
    for (const responderEntityID of responderEntityIDs) {
      assert.strictEqual(
        attackerFirstAcquireModes.get(responderEntityID),
        "WARP",
        `pilot should first acquire responder ${responderEntityID} while it is still in warp`,
      );
      assert.strictEqual(
        victimFirstAcquireModes.get(responderEntityID),
        "WARP",
        `observer should first acquire responder ${responderEntityID} while it is still in warp`,
      );
    }
    const observerResponseNames = [
      ...flattenDestinyPayloadNames(attackerSession.notifications),
      ...flattenDestinyPayloadNames(victimSession.notifications),
    ];
    const attackerResponseEntries = extractDestinyEntries(attackerSession.notifications);
    const victimResponseEntries = extractDestinyEntries(victimSession.notifications);
    const attackerEntityWarpInEntityIDs = new Set(
      collectEntityIDsForPayloadName(attackerSession.notifications, "EntityWarpIn"),
    );
    const victimEntityWarpInEntityIDs = new Set(
      collectEntityIDsForPayloadName(victimSession.notifications, "EntityWarpIn"),
    );
    assert(
      observerResponseNames.includes("EntityWarpIn"),
      "Observers should receive EntityWarpIn when off-grid Crimewatch responders first acquire during warp-in",
    );
    assert(
      !observerResponseNames.includes("WarpTo"),
      "Off-grid Crimewatch responders should not leak the origin departure WarpTo contract to pilot or observer",
    );
    assert(
      !observerResponseNames.includes("OnSpecialFX"),
      "Fresh Crimewatch warp-in acquire should stay on the native EntityWarpIn path instead of replaying generic warp FX",
    );
    for (const responderEntityID of responderEntityIDs) {
      assert(
        attackerEntityWarpInEntityIDs.has(responderEntityID),
        `pilot should receive EntityWarpIn for responder ${responderEntityID}`,
      );
      assert(
        victimEntityWarpInEntityIDs.has(responderEntityID),
        `observer should receive EntityWarpIn for responder ${responderEntityID}`,
      );
    }
    const attackerFirstResponderWarpStart = attackerResponseEntries.find(
      (entry) => entry.name === "EntityWarpIn" && responderEntityIDs.includes(Number(entry.args && entry.args[0])),
    );
    const attackerLastResponderWarpStart = [...attackerResponseEntries].reverse().find(
      (entry) => entry.name === "EntityWarpIn" && responderEntityIDs.includes(Number(entry.args && entry.args[0])),
    );
    assert(
      attackerFirstResponderWarpStart && attackerLastResponderWarpStart,
      "expected pilot responder EntityWarpIn updates in the destiny stream",
    );
    assert(
      Math.abs(attackerLastResponderWarpStart.stamp - attackerFirstResponderWarpStart.stamp) <= 1,
      "Crimewatch responder warp-in acquire should be tightly batched for the pilot",
    );
    const victimFirstResponderWarpStart = victimResponseEntries.find(
      (entry) => entry.name === "EntityWarpIn" && responderEntityIDs.includes(Number(entry.args && entry.args[0])),
    );
    const victimLastResponderWarpStart = [...victimResponseEntries].reverse().find(
      (entry) => entry.name === "EntityWarpIn" && responderEntityIDs.includes(Number(entry.args && entry.args[0])),
    );
    assert(
      victimFirstResponderWarpStart && victimLastResponderWarpStart,
      "expected observer responder EntityWarpIn updates in the destiny stream",
    );
    assert(
      Math.abs(victimLastResponderWarpStart.stamp - victimFirstResponderWarpStart.stamp) <= 1,
      "Crimewatch responder warp-in acquire should be tightly batched for the observer",
    );
    const respondersEngagedAfterWarp = advanceSceneUntil(
      scene,
      12_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          (responderEntity.mode === "ORBIT" || responderEntity.mode === "FOLLOW") &&
          Number(responderEntity.targetEntityID) === Number(attackerEntity.itemID);
      }),
    );
    assert(
      respondersEngagedAfterWarp,
      "All CONCORD responders should resume active pursuit after warp completion",
    );
    const respondersThatActivatedWeaponsAfterWarp = new Set();
    const respondersActivatedWeaponsAfterWarp = advanceSceneUntil(
      scene,
      12_000,
      250,
      () => {
        for (const entityID of responderEntityIDs) {
          const responderEntity = scene.getEntityByID(entityID);
          if (
            responderEntity &&
            responderEntity.activeModuleEffects instanceof Map &&
            responderEntity.activeModuleEffects.size > 0
          ) {
            respondersThatActivatedWeaponsAfterWarp.add(entityID);
          }
        }
        return respondersThatActivatedWeaponsAfterWarp.size === responderEntityIDs.length;
      },
    );
    assert(
      respondersActivatedWeaponsAfterWarp,
      "Every responder in the CONCORD wing should reach active weapon fire after warp-in, including the heavier execution hulls",
    );
    const responderSummariesAfterWarp = npcService.getNpcOperatorSummary().filter((summary) =>
      responderEntityIDs.includes(summary.entityID)
    );
    assert(
      responderSummariesAfterWarp.every((summary) =>
        Number(summary.currentTargetID) === Number(attackerEntity.itemID)
      ),
      "Responders should keep the criminal attacker as their active target after warp-in",
    );

    const attackerCapsuleItem = {
      itemID: attackerSession.shipItem.itemID + 1,
      typeID: TEST_CAPSULE_TYPE_ID,
      ownerID: attackerSession.characterID,
      groupID: 29,
      categoryID: 6,
      radius: 20,
      spaceState: {
        position: {
          x: attackerEntity.position.x,
          y: attackerEntity.position.y,
          z: attackerEntity.position.z,
        },
        velocity: { x: 0, y: 0, z: 0 },
        direction: {
          x: attackerEntity.direction.x,
          y: attackerEntity.direction.y,
          z: attackerEntity.direction.z,
        },
        mode: "STOP",
        speedFraction: 0,
      },
    };
    const abandonedAttackerEntity = scene.disembarkSession(attackerSession, {
      broadcast: true,
    });
    assert(abandonedAttackerEntity, "expected attacker hull to disembark during ship-loss simulation");
    const attackerCapsuleEntity = runtime.attachSession(attackerSession, attackerCapsuleItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: true,
      spawnStopped: true,
      beyonceBound: true,
      initialStateSent: true,
      emitEgoBallAdd: true,
    });
    assert(attackerCapsuleEntity, "expected attacker capsule to attach after ship-loss simulation");
    attackerSession.notifications.length = 0;
    victimSession.notifications.length = 0;
    const destroyHullResult = scene.removeDynamicEntity(attackerEntity.itemID, {
      allowSessionOwned: false,
      terminalDestructionEffectID: 1,
    });
    assert.strictEqual(
      destroyHullResult.success,
      true,
      destroyHullResult.errorMsg || "expected attacker hull removal after ship-loss simulation",
    );
    const respondersPersistAfterShipLoss = advanceSceneUntil(
      scene,
      5_000,
      250,
      () => {
        const summaries = npcService.getNpcOperatorSummary().filter((summary) =>
          responderEntityIDs.includes(summary.entityID)
        );
        return (
          summaries.length === responderEntityIDs.length &&
          summaries.every((summary) => summary.manualOrderType === "stop") &&
          responderEntityIDs.every((entityID) => {
            const responderEntity = scene.getEntityByID(entityID);
            return (
              responderEntity &&
              responderEntity.mode === "STOP" &&
              Number(responderEntity.speedFraction || 0) <= 0
            );
          })
        );
      },
    );
    assert(
      respondersPersistAfterShipLoss,
      "Responders should stay visible and fully stop instead of lingering in warp when the criminal loses their ship",
    );
    assert(
      responderEntityIDs.every((entityID) => Boolean(scene.getEntityByID(entityID))),
      "Expected CONCORD responders to remain live after the criminal is reduced to a capsule",
    );
    assert(
      responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(victimSession).has(entityID)),
      "Observers should keep seeing CONCORD responders after the criminal loses their ship",
    );
    const attackerStopPayloads = collectDestinyPayloads(attackerSession.notifications);
    const victimStopPayloads = collectDestinyPayloads(victimSession.notifications);
    for (const responderEntityID of responderEntityIDs) {
      assert(
        attackerStopPayloads.some((entry) =>
          entry.name === "SetBallPosition" &&
          Number(entry.args && entry.args[0] || 0) === Number(responderEntityID)
        ),
        `killed player should receive an authoritative parked position for responder ${responderEntityID}`,
      );
      assert(
        victimStopPayloads.some((entry) =>
          entry.name === "SetBallPosition" &&
          Number(entry.args && entry.args[0] || 0) === Number(responderEntityID)
        ),
        `observer should receive an authoritative parked position for responder ${responderEntityID}`,
      );
    }

    const clearResult = crimewatchState.setCharacterCrimewatchDebugState(
      attackerSession.characterID,
      {
        clearTimers: true,
        criminal: false,
      },
      {
        now: scene.getCurrentSimTimeMs(),
        systemID: TEST_SYSTEM_ID,
      },
    );
    assert.strictEqual(clearResult.success, true, "expected debug crimewatch clear to succeed");
    advanceSceneByMs(scene, 1_500, 6);
    const concordAfterClear = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert.strictEqual(
      concordAfterClear.length,
      0,
      "Crimewatch response CONCORD should despawn after the criminal state clears",
    );
    database.flushAllSync();
    const persistedAfterClear = snapshotPersistedNpcTables();
    assert.deepStrictEqual(
      persistedAfterClear,
      persistedBefore,
      "Crimewatch response cleanup should leave persisted player and native NPC tables unchanged",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      expectedResponderCount,
      concordCount: concordSummaries.length,
      attackerCriminal: true,
      observerResponseNames,
    }, null, 2));
  } finally {
    config.crimewatchConcordPodKillEnabled = originalPodKillEnabled;
    if (attackerSession && attackerSession._space) {
      runtime.detachSession(attackerSession, { broadcast: false });
    }
    if (victimSession && victimSession._space) {
      runtime.detachSession(victimSession, { broadcast: false });
    }
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "concord",
      removeContents: true,
    });
    crimewatchState.clearAllCrimewatchState();
    clearControllers();
    runtime._testing.clearScenes();
  }
}

main();
setImmediate(() => process.exit(0));
