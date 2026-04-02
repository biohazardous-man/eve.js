/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../../server/src/services/_shared/stationStaticData"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const TEST_STATION_ID = 60003760;
const ATTACKER_CLIENT_ID = 978401;
const ATTACKER_CHARACTER_ID = 979401;

function createFakeSession(clientID, characterID, position, direction) {
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
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
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

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const x = Number(vector && vector.x || 0);
  const y = Number(vector && vector.y || 0);
  const z = Number(vector && vector.z || 0);
  const magnitude = Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
  if (magnitude > 0.000001) {
    return {
      x: x / magnitude,
      y: y / magnitude,
      z: z / magnitude,
    };
  }
  return fallback;
}

function getSurfaceDistance(left, right) {
  const dx = Number((left && left.position && left.position.x) || 0) -
    Number((right && right.position && right.position.x) || 0);
  const dy = Number((left && left.position && left.position.y) || 0) -
    Number((right && right.position && right.position.y) || 0);
  const dz = Number((left && left.position && left.position.z) || 0) -
    Number((right && right.position && right.position.z) || 0);
  return Math.max(
    0,
    Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2)) -
      Number(left && left.radius || 0) -
      Number(right && right.radius || 0),
  );
}

function getVisibleDynamicEntityIDs(session) {
  return session &&
    session._space &&
    session._space.visibleDynamicEntityIDs instanceof Set
    ? session._space.visibleDynamicEntityIDs
    : new Set();
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

function collectEntityIDsForPayloadName(notifications, payloadName) {
  return collectDestinyPayloads(notifications)
    .filter((entry) => entry.name === payloadName)
    .map((entry) => Number(entry.args && entry.args[0] || 0))
    .filter((entityID) => entityID > 0);
}

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    removeContents: true,
  });

  let attackerSession = null;

  try {
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const station = scene.getEntityByID(TEST_STATION_ID);
    const stationRecord = getStationRecord(null, TEST_STATION_ID);
    assert(station, "expected Jita 4-4 station entity");
    assert(
      stationRecord && stationRecord.undockPosition,
      "expected Jita 4-4 undock position",
    );

    const undockDirection = normalizeVector({
      x: Number(stationRecord.undockPosition.x || 0) - Number(station.position && station.position.x || 0),
      y: Number(stationRecord.undockPosition.y || 0) - Number(station.position && station.position.y || 0),
      z: Number(stationRecord.undockPosition.z || 0) - Number(station.position && station.position.z || 0),
    });
    const attackerPosition = {
      x: Number(stationRecord.undockPosition.x || 0) + (undockDirection.x * 2_500),
      y: Number(stationRecord.undockPosition.y || 0) + (undockDirection.y * 2_500),
      z: Number(stationRecord.undockPosition.z || 0) + (undockDirection.z * 2_500),
    };

    attackerSession = createFakeSession(
      ATTACKER_CLIENT_ID,
      ATTACKER_CHARACTER_ID,
      attackerPosition,
      undockDirection,
    );
    attachReadySession(attackerSession);

    const attackerEntity = scene.getEntityByID(attackerSession._space.shipID);
    assert(attackerEntity, "expected attacker entity");

    const offenseResult = crimewatchState.triggerHighSecCriminalOffense(
      scene,
      attackerEntity,
      {
        now: scene.getCurrentSimTimeMs(),
        reason: "SELFTEST_STATION_UNDOCK_CRIME",
      },
    );
    assert.strictEqual(
      offenseResult.success,
      true,
      offenseResult.errorMsg || "crimewatch offense trigger failed",
    );
    assert.strictEqual(
      offenseResult.data && offenseResult.data.applied,
      true,
      "expected /naughty-style crimewatch offense to apply in Jita",
    );

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    advanceSceneByMs(scene, responseDelayMs + 500, 8);

    const responderSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    const expectedResponderCount = crimewatchState.getConcordResponseShipCountForSystem(
      scene.system,
    );
    assert.strictEqual(
      responderSummaries.length,
      expectedResponderCount,
      `expected the full ${expectedResponderCount}-ship CONCORD response wing at station undock`,
    );

    const responderEntityIDs = responderSummaries.map((summary) => summary.entityID);
    const attackerClusterKey = scene.getPublicGridClusterKeyForEntity(attackerEntity);
    assert(
      responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        const originPosition =
          responderEntity &&
          responderEntity.warpState &&
          responderEntity.warpState.origin
            ? responderEntity.warpState.origin
            : responderEntity && responderEntity.position;
        return responderEntity &&
          scene.getPublicGridClusterKeyForPosition(originPosition) !==
            attackerClusterKey;
      }),
      "station-undock CONCORD responders should originate from the shared safe off-grid warp anchor",
    );
    assert(
      responderEntityIDs.every((entityID) => !getVisibleDynamicEntityIDs(attackerSession).has(entityID)),
      "station-undock CONCORD responders should not leak the far origin spawn to the pilot",
    );

    const firstAcquireModes = new Map();
    const acquiredAllResponders = advanceSceneUntil(
      scene,
      10_000,
      250,
      () => {
        for (const responderEntityID of responderEntityIDs) {
          if (!firstAcquireModes.has(responderEntityID) &&
            getVisibleDynamicEntityIDs(attackerSession).has(responderEntityID)) {
            const responderEntity = scene.getEntityByID(responderEntityID);
            firstAcquireModes.set(
              responderEntityID,
              responderEntity ? responderEntity.mode : null,
            );
          }
        }
        return responderEntityIDs.every((entityID) =>
          getVisibleDynamicEntityIDs(attackerSession).has(entityID)
        );
      },
    );
    assert(acquiredAllResponders, "expected pilot to acquire the full CONCORD wing during station response");
    for (const responderEntityID of responderEntityIDs) {
      assert.strictEqual(
        firstAcquireModes.get(responderEntityID),
        "WARP",
        `expected responder ${responderEntityID} to be acquired while still in the station-undock warp-in flow`,
      );
    }

    const entityWarpInEntityIDs = new Set(
      collectEntityIDsForPayloadName(attackerSession.notifications, "EntityWarpIn"),
    );
    for (const responderEntityID of responderEntityIDs) {
      assert(
        entityWarpInEntityIDs.has(responderEntityID),
        `expected pilot to receive EntityWarpIn for responder ${responderEntityID} at station undock`,
      );
    }
    assert.strictEqual(
      collectEntityIDsForPayloadName(attackerSession.notifications, "WarpTo").length > 0,
      false,
      "station-undock CONCORD should not leak the origin departure WarpTo contract to the pilot",
    );

    const allRespondersEngaged = advanceSceneUntil(
      scene,
      18_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          (responderEntity.mode === "ORBIT" || responderEntity.mode === "FOLLOW") &&
          Number(responderEntity.targetEntityID) === Number(attackerEntity.itemID) &&
          getSurfaceDistance(responderEntity, attackerEntity) < 15_000 &&
          responderEntity.activeModuleEffects instanceof Map &&
          responderEntity.activeModuleEffects.size > 0;
      }),
    );
    assert(
      allRespondersEngaged,
      "expected the full station-undock CONCORD wing to engage, chase, and fire instead of leaving heavier hulls idle",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      expectedResponderCount,
      stationID: TEST_STATION_ID,
      acquiredAllResponders,
      allRespondersEngaged,
    }, null, 2));
  } finally {
    if (attackerSession && attackerSession._space) {
      runtime.detachSession(attackerSession, { broadcast: false });
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
