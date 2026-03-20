const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

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
        args: entry[1].slice(1),
      }),
    ),
  );
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

    const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert(
      concordSummaries.length > 0,
      "CONCORD responders should spawn after criminal aggression in high sec",
    );
    const concordEntities = concordSummaries
      .map((summary) => scene.getEntityByID(summary.entityID))
      .filter(Boolean);
    assert(
      concordEntities.length > 0,
      "Expected live CONCORD entities after response spawn",
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
      concordSummaries.some((summary) => summary.currentTargetID === attackerEntity.itemID),
      "At least one CONCORD responder should immediately task onto the criminal attacker",
    );
    const responderEntityIDs = concordEntities.map((entity) => entity.itemID);
    assert(
      responderEntityIDs.every(
        (entityID) => !getVisibleDynamicEntityIDs(attackerSession).has(entityID),
      ),
      "The criminal pilot should not acquire CONCORD at the off-grid origin before warp visibility",
    );
    assert(
      responderEntityIDs.every(
        (entityID) => !getVisibleDynamicEntityIDs(victimSession).has(entityID),
      ),
      "Observers should not acquire CONCORD at the off-grid origin before warp visibility",
    );
    const spawnTickObserverResponseNames = [
      ...flattenDestinyPayloadNames(attackerSession.notifications),
      ...flattenDestinyPayloadNames(victimSession.notifications),
    ];
    assert(
      !spawnTickObserverResponseNames.includes("AddBalls2"),
      "Responders should not be added before they become visible in warp",
    );

    attackerSession.notifications.length = 0;
    victimSession.notifications.length = 0;
    const acquiredAllResponders = advanceSceneUntil(
      scene,
      20_000,
      250,
      () => (
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(attackerSession).has(entityID)) &&
        responderEntityIDs.every((entityID) => getVisibleDynamicEntityIDs(victimSession).has(entityID))
      ),
    );
    assert(
      acquiredAllResponders,
      "Both pilot and observer should eventually acquire all CONCORD responders during warp-in",
    );
    const observerResponseNames = [
      ...flattenDestinyPayloadNames(attackerSession.notifications),
      ...flattenDestinyPayloadNames(victimSession.notifications),
    ];
    assert(
      observerResponseNames.includes("EntityWarpIn"),
      "Observers should receive EntityWarpIn for responder arrival parity",
    );
    assert(
      !observerResponseNames.includes("WarpTo"),
      "Observers who first acquire responders mid-warp should not receive the departure WarpTo contract",
    );
    assert(
      observerResponseNames.includes("OnSpecialFX"),
      "Observers should receive responder warp FX",
    );
    const respondersEngagedAfterWarp = advanceSceneUntil(
      scene,
      20_000,
      250,
      () => responderEntityIDs.every((entityID) => {
        const responderEntity = scene.getEntityByID(entityID);
        return responderEntity &&
          responderEntity.mode === "ORBIT" &&
          Number(responderEntity.targetEntityID) === Number(attackerEntity.itemID);
      }),
    );
    assert(
      respondersEngagedAfterWarp,
      "All CONCORD responders should resume orbit pursuit after warp completion",
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
          Number((entry.args[0] || [])[0]) === Number(responderEntityID)
        ),
        `killed player should receive an authoritative parked position for responder ${responderEntityID}`,
      );
      assert(
        victimStopPayloads.some((entry) =>
          entry.name === "SetBallPosition" &&
          Number((entry.args[0] || [])[0]) === Number(responderEntityID)
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

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      concordCount: concordSummaries.length,
      attackerCriminal: true,
      spawnTickObserverResponseNames,
      observerResponseNames,
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
