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
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const ATTACKER_CLIENT_ID = 978301;
const ATTACKER_CHARACTER_ID = 979301;
const VICTIM_CLIENT_ID = 978302;
const VICTIM_CHARACTER_ID = 979302;
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

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    removeContents: true,
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
      `expected the full ${expectedResponderCount}-ship CONCORD response wing`,
    );
    const responderEntityIDs = concordSummaries.map((summary) => summary.entityID);
    const allRespondersCompletedWarp = advanceSceneUntil(
      scene,
      20_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          responderEntity.mode !== "WARP" &&
          !responderEntity.warpState;
      }),
    );
    assert(
      allRespondersCompletedWarp,
      "expected the full CONCORD response wing to complete warp and enter active pursuit promptly",
    );

    const respondersEnteredActivePursuit = advanceSceneUntil(
      scene,
      8_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return (
          responderEntity &&
          (
            responderEntity.mode === "ORBIT" ||
            responderEntity.mode === "FOLLOW"
          ) &&
          Number(responderEntity.targetEntityID) === Number(attackerEntity.itemID) &&
          getSurfaceDistance(responderEntity, attackerEntity) < 25_000 &&
          Math.sqrt(
            ((responderEntity.velocity && responderEntity.velocity.x) || 0) ** 2 +
            ((responderEntity.velocity && responderEntity.velocity.y) || 0) ** 2 +
            ((responderEntity.velocity && responderEntity.velocity.z) || 0) ** 2
          ) > 0
        );
      }),
    );
    assert(
      respondersEnteredActivePursuit,
      "expected the full CONCORD response wing to enter active pursuit after warp completion",
    );

    const baselineDistances = new Map(
      responderEntityIDs.map((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return [
          entityID,
          responderEntity ? getSurfaceDistance(responderEntity, attackerEntity) : 0,
        ];
      }),
    );
    attackerEntity.position = {
      x: attackerEntity.position.x + 70_000,
      y: attackerEntity.position.y,
      z: attackerEntity.position.z,
    };
    const allRespondersChasedRetreat = advanceSceneUntil(
      scene,
      10_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        const baselineDistance = baselineDistances.get(entityID) || 0;
        return responderEntity &&
          getSurfaceDistance(responderEntity, attackerEntity) < (baselineDistance + 65_000) &&
          Math.sqrt(
            ((responderEntity.velocity && responderEntity.velocity.x) || 0) ** 2 +
            ((responderEntity.velocity && responderEntity.velocity.y) || 0) ** 2 +
            ((responderEntity.velocity && responderEntity.velocity.z) || 0) ** 2
          ) > 0;
      }),
    );
    assert(
      allRespondersChasedRetreat,
      "expected every responder in the wing to actively chase once the criminal opens range again",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      expectedResponderCount,
      chasedRetreat: true,
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

main();
setImmediate(() => process.exit(0));
