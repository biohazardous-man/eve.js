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
const TEST_CAPSULE_TYPE_ID = 670;
const ATTACKER_CLIENT_ID = 978101;
const ATTACKER_CHARACTER_ID = 979101;
const VICTIM_CLIENT_ID = 978102;
const VICTIM_CHARACTER_ID = 979102;
const TEST_POSITION = Object.freeze({
  x: -107303362560,
  y: -18744975360,
  z: 436489052160,
});

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

function getVisibleDynamicEntityIDs(session) {
  return session &&
    session._space &&
    session._space.visibleDynamicEntityIDs instanceof Set
    ? session._space.visibleDynamicEntityIDs
    : new Set();
}

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
  });

  let attackerSession = null;
  let victimSession = null;

  try {
    attackerSession = createFakeSession(
      ATTACKER_CLIENT_ID,
      ATTACKER_CHARACTER_ID,
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

    const aggressionResult = crimewatchState.recordHighSecCriminalAggression(
      scene,
      attackerEntity,
      victimEntity,
      scene.getCurrentSimTimeMs(),
    );
    assert.strictEqual(
      aggressionResult.success,
      true,
      aggressionResult.errorMsg || "crimewatch aggression record failed",
    );

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    advanceSceneByMs(scene, responseDelayMs + 500, 8);

    const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert(concordSummaries.length > 0, "expected CONCORD responders");
    const responderEntityIDs = concordSummaries.map((summary) => summary.entityID);

    const acquiredAllResponders = advanceSceneUntil(
      scene,
      20_000,
      250,
      () => responderEntityIDs.every((entityID) => (
        getVisibleDynamicEntityIDs(attackerSession).has(entityID) &&
        getVisibleDynamicEntityIDs(victimSession).has(entityID)
      )),
    );
    assert(
      acquiredAllResponders,
      "expected both pilot and observer to acquire responders while they are still warping in",
    );

    const capsuleItem = {
      itemID: attackerSession.shipItem.itemID + 1,
      typeID: TEST_CAPSULE_TYPE_ID,
      ownerID: attackerSession.characterID,
      groupID: 29,
      categoryID: 6,
      radius: 20,
      spaceState: {
        position: clonePosition(attackerEntity.position),
        velocity: { x: 0, y: 0, z: 0 },
        direction: clonePosition(attackerEntity.direction),
        mode: "STOP",
        speedFraction: 0,
      },
    };
    const abandonedAttackerEntity = scene.disembarkSession(attackerSession, {
      broadcast: true,
    });
    assert(abandonedAttackerEntity, "expected attacker hull to disembark");
    const attackerCapsuleEntity = runtime.attachSession(attackerSession, capsuleItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: true,
      spawnStopped: true,
      beyonceBound: true,
      initialStateSent: true,
      emitEgoBallAdd: true,
    });
    assert(attackerCapsuleEntity, "expected attacker capsule to attach");
    const destroyHullResult = scene.removeDynamicEntity(attackerEntity.itemID, {
      allowSessionOwned: false,
      terminalDestructionEffectID: 1,
    });
    assert.strictEqual(
      destroyHullResult.success,
      true,
      destroyHullResult.errorMsg || "expected attacker hull removal after ship-loss simulation",
    );

    const respondersStoppedAfterMidWarpLoss = advanceSceneUntil(
      scene,
      2_500,
      100,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          responderEntity.mode === "STOP" &&
          Number(responderEntity.speedFraction || 0) <= 0 &&
          !responderEntity.warpState;
      }),
    );
    assert(
      respondersStoppedAfterMidWarpLoss,
      "responders should not stay stuck in warp when the criminal loses their ship mid-arrival",
    );
    assert(
      responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(victimSession).has(entityID)),
      "observer should keep seeing all responders after the criminal dies mid-arrival",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      concordCount: responderEntityIDs.length,
    }, null, 2));
  } finally {
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

function clonePosition(vector) {
  return {
    x: Number(vector && vector.x) || 0,
    y: Number(vector && vector.y) || 0,
    z: Number(vector && vector.z) || 0,
  };
}

main();
setImmediate(() => process.exit(0));
