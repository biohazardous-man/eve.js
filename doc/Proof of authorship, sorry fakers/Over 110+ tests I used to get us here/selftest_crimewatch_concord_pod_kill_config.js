/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const config = require(path.join(__dirname, "../../server/src/config"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const ATTACKER_CLIENT_ID = 968201;
const ATTACKER_CHARACTER_ID = 978201;
const VICTIM_CLIENT_ID = 968202;
const VICTIM_CHARACTER_ID = 978202;
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

function main() {
  const originalPodKillEnabled = config.crimewatchConcordPodKillEnabled;
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
    config.crimewatchConcordPodKillEnabled = true;

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

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    const expectedResponderCount = crimewatchState.getConcordResponseShipCountForSystem(
      scene.system,
    );
    const respondersArrived = advanceSceneUntil(
      scene,
      responseDelayMs + 25_000,
      250,
      () => {
        const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
          summary.systemID === TEST_SYSTEM_ID &&
          summary.entityType === "concord"
        ));
        return (
          concordSummaries.length === expectedResponderCount &&
          concordSummaries.every((summary) =>
            Number(summary.currentTargetID) === Number(attackerEntity.itemID)
          )
        );
      },
    );
    assert(
      respondersArrived,
      "expected CONCORD responders to spawn and target the criminal ship before pod-kill checks",
    );

    const abandonedAttackerEntity = scene.disembarkSession(attackerSession, {
      broadcast: true,
    });
    assert(
      abandonedAttackerEntity,
      "expected the criminal hull to disembark during pod-kill setup",
    );
    const attackerCapsuleItem = {
      itemID: attackerSession.shipItem.itemID + 1,
      typeID: 670,
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
    const attackerCapsuleEntity = runtime.attachSession(attackerSession, attackerCapsuleItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: true,
      spawnStopped: true,
      beyonceBound: true,
      initialStateSent: true,
      emitEgoBallAdd: true,
    });
    assert(attackerCapsuleEntity, "expected the criminal capsule to attach during pod-kill setup");
    const destroyHullResult = scene.removeDynamicEntity(attackerEntity.itemID, {
      allowSessionOwned: false,
      terminalDestructionEffectID: 1,
    });
    assert.strictEqual(
      destroyHullResult.success,
      true,
      destroyHullResult.errorMsg || "expected the criminal hull removal to succeed",
    );
    assert(
      attackerSession._space && Number(attackerSession._space.shipID) > 0,
      "expected the attacker to still be in space inside a capsule after ship destruction",
    );
    const capsuleEntityID = Number(attackerSession._space.shipID);

    const respondersRetaskedToPod = advanceSceneUntil(
      scene,
      10_000,
      250,
      () => {
        const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
          summary.systemID === TEST_SYSTEM_ID &&
          summary.entityType === "concord"
        ));
        return (
          concordSummaries.length === expectedResponderCount &&
          concordSummaries.every((summary) =>
            Number(summary.currentTargetID) === capsuleEntityID &&
            String(summary.manualOrderType || "").toLowerCase() === "attack"
          )
        );
      },
    );
    assert(
      respondersRetaskedToPod,
      "with crimewatchConcordPodKillEnabled on, CONCORD should retask from the destroyed ship onto the criminal capsule",
    );

    runtime.detachSession(attackerSession, { broadcast: false });
    assert(
      !attackerSession._space || Number(attackerSession._space.systemID || 0) !== TEST_SYSTEM_ID,
      "expected the criminal capsule to leave the scene after pod-kill cleanup",
    );

    const respondersClearedAfterPodKill = advanceSceneUntil(
      scene,
      10_000,
      250,
      () => npcService.getNpcOperatorSummary().filter((summary) => (
        summary.systemID === TEST_SYSTEM_ID &&
        summary.entityType === "concord"
      )).length === 0,
    );
    assert(
      respondersClearedAfterPodKill,
      "responders should despawn shortly after the criminal capsule is destroyed and leaves the scene",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      expectedResponderCount,
      capsuleEntityID,
      podKillEnabled: config.crimewatchConcordPodKillEnabled === true,
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
