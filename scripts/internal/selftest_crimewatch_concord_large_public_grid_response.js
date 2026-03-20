const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const TEST_PUBLIC_GRID_BOX_METERS = 7_864_320;
const MAX_EXPECTED_RESPONSE_WARP_DISTANCE_METERS = 1_100_000;
const MIN_EXPECTED_RESPONSE_WARP_DISTANCE_METERS = 450_000;
const TEST_POSITION = Object.freeze({
  x: -107303362560,
  y: -18744975360,
  z: 436489052160,
});

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

function magnitude(vector) {
  const x = Number(vector && vector.x) || 0;
  const y = Number(vector && vector.y) || 0;
  const z = Number(vector && vector.z) || 0;
  return Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
}

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
  });

  const sessions = [];
  try {
    const attackerSession = createFakeSession(
      969001,
      979001,
      TEST_SYSTEM_ID,
      {
        x: TEST_POSITION.x,
        y: TEST_POSITION.y,
        z: TEST_POSITION.z,
      },
      { x: 1, y: 0, z: 0 },
    );
    const victimSession = createFakeSession(
      969002,
      979002,
      TEST_SYSTEM_ID,
      {
        x: TEST_POSITION.x + 4_000,
        y: TEST_POSITION.y,
        z: TEST_POSITION.z,
      },
      { x: -1, y: 0, z: 0 },
    );
    sessions.push(attackerSession, victimSession);

    for (let index = 1; index <= 4; index += 1) {
      sessions.push(createFakeSession(
        969002 + index,
        979002 + index,
        TEST_SYSTEM_ID,
        {
          x: TEST_POSITION.x + (TEST_PUBLIC_GRID_BOX_METERS * index),
          y: TEST_POSITION.y,
          z: TEST_POSITION.z,
        },
        { x: -1, y: 0, z: 0 },
      ));
    }

    for (const session of sessions) {
      attachReadySession(session);
    }

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

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    assert(responseDelayMs > 0, "expected a high-sec CONCORD response delay");
    advanceSceneByMs(
      scene,
      Math.max(0, responseDelayMs - 250),
      Math.max(1, Math.trunc(Math.max(0, responseDelayMs - 250) / 250)),
    );
    advanceSceneByMs(scene, 500, 2);

    const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert.strictEqual(
      concordSummaries.length,
      3,
      "Expected a full three-ship CONCORD response wing",
    );

    const responderEntityIDs = concordSummaries.map((summary) => summary.entityID);
    const responderEntities = responderEntityIDs
      .map((entityID) => scene.getEntityByID(entityID))
      .filter(Boolean);
    assert.strictEqual(
      responderEntities.length,
      3,
      "Expected live CONCORD response entities",
    );
    responderEntities.forEach((entity) => {
      assert.strictEqual(entity.mode, "WARP", "responders should begin in warp");
      assert(
        entity.warpState &&
          magnitude({
            x: entity.warpState.targetPoint.x - entity.warpState.origin.x,
            y: entity.warpState.targetPoint.y - entity.warpState.origin.y,
            z: entity.warpState.targetPoint.z - entity.warpState.origin.z,
          }) <= MAX_EXPECTED_RESPONSE_WARP_DISTANCE_METERS,
        "dense public-grid response origins should be capped to a reasonable warp distance",
      );
      assert(
        entity.warpState &&
          magnitude({
            x: entity.warpState.targetPoint.x - entity.warpState.origin.x,
            y: entity.warpState.targetPoint.y - entity.warpState.origin.y,
            z: entity.warpState.targetPoint.z - entity.warpState.origin.z,
          }) >= MIN_EXPECTED_RESPONSE_WARP_DISTANCE_METERS,
        "response warp origin should still remain meaningfully off-grid",
      );
    });

    attackerSession.notifications.length = 0;
    victimSession.notifications.length = 0;
    const acquiredAllResponders = advanceSceneUntil(
      scene,
      15_000,
      250,
      () => (
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(attackerSession).has(entityID)) &&
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(victimSession).has(entityID))
      ),
    );
    assert(
      acquiredAllResponders,
      "dense public-grid Crimewatch responders should still become visible to pilot and observer",
    );

    const responseNames = [
      ...flattenDestinyPayloadNames(attackerSession.notifications),
      ...flattenDestinyPayloadNames(victimSession.notifications),
    ];
    assert(
      responseNames.includes("EntityWarpIn"),
      "visible dense-grid responders should still deliver EntityWarpIn updates",
    );
    assert(
      !responseNames.includes("WarpTo"),
      "dense-grid responders first acquired mid-warp should not replay the departure WarpTo contract",
    );
  } finally {
    for (const session of sessions) {
      if (session && session._space) {
        runtime.detachSession(session, { broadcast: false });
      }
    }
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "concord",
    });
    crimewatchState.clearAllCrimewatchState();
    clearControllers();
    runtime._testing.clearScenes();
  }
}

main();
