/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));

const testing = runtime._testing;
const TEST_SYSTEM_ID = 30000142;
const ISOLATED_PUBLIC_GRID_ORIGIN = {
  x: testing.PUBLIC_GRID_BOX_METERS * 120,
  y: testing.PUBLIC_GRID_BOX_METERS * -44,
  z: testing.PUBLIC_GRID_BOX_METERS * 29,
};

function buildIsolatedPosition(xOffset = 0, yOffset = 0, zOffset = 0) {
  return {
    x: ISOLATED_PUBLIC_GRID_ORIGIN.x + xOffset,
    y: ISOLATED_PUBLIC_GRID_ORIGIN.y + yOffset,
    z: ISOLATED_PUBLIC_GRID_ORIGIN.z + zOffset,
  };
}

function createFakeSession(clientID, characterID, systemID, position, direction) {
  const notifications = [];
  return {
    clientID,
    characterID,
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
        args: entry[1][1],
      }),
    ),
  );
}

function attachReadySession(session) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
}

function runBubbleOverlapCheck() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(TEST_SYSTEM_ID);
  assert(scene, "Expected test scene");

  const first = testing.buildRuntimeShipEntityForTesting({
    itemID: 950001,
    typeID: 606,
    ownerID: 500001,
    corporationID: 500001,
    itemName: "Overlap One",
    position: buildIsolatedPosition(0, 0, 0),
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
  }, TEST_SYSTEM_ID);
  const second = testing.buildRuntimeShipEntityForTesting({
    itemID: 950002,
    typeID: 606,
    ownerID: 500002,
    corporationID: 500002,
    itemName: "Overlap Two",
    position: buildIsolatedPosition(400000, 0, 0),
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
  }, TEST_SYSTEM_ID);

  assert.strictEqual(scene.spawnDynamicEntity(first, { broadcast: false }).success, true);
  assert.strictEqual(scene.spawnDynamicEntity(second, { broadcast: false }).success, true);
  assert.notStrictEqual(first.bubbleID, second.bubbleID, "Entities should land in separate bubbles");

  const firstBubble = scene.getBubbleByID(first.bubbleID);
  const secondBubble = scene.getBubbleByID(second.bubbleID);
  assert(firstBubble && secondBubble, "Expected both bubbles to exist");

  const bubbleCenterDistance = Math.sqrt(
    ((firstBubble.center.x - secondBubble.center.x) ** 2) +
    ((firstBubble.center.y - secondBubble.center.y) ** 2) +
    ((firstBubble.center.z - secondBubble.center.z) ** 2),
  );
  assert(
    bubbleCenterDistance >= testing.BUBBLE_CENTER_MIN_DISTANCE_METERS,
    "New bubble centers should be nudged clear of overlap",
  );

  return {
    firstBubbleID: first.bubbleID,
    secondBubbleID: second.bubbleID,
    firstBubbleUUID: firstBubble.uuid,
    secondBubbleUUID: secondBubble.uuid,
    bubbleCenterDistance,
  };
}

function runDynamicEntityVisibilityCheck() {
  runtime._testing.clearScenes();

  const nearSessionA = createFakeSession(
    960001,
    970001,
    TEST_SYSTEM_ID,
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const nearSessionB = createFakeSession(
    960002,
    970002,
    TEST_SYSTEM_ID,
    { x: 1000, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  );
  const farSession = createFakeSession(
    960003,
    970003,
    TEST_SYSTEM_ID,
    { x: testing.PUBLIC_GRID_BOX_METERS * 2, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  );

  attachReadySession(nearSessionA);
  attachReadySession(nearSessionB);
  attachReadySession(farSession);

  nearSessionA.notifications.length = 0;
  nearSessionB.notifications.length = 0;
  farSession.notifications.length = 0;

  const spawnResult = runtime.spawnDynamicShip(TEST_SYSTEM_ID, {
    itemID: 980001,
    typeID: 606,
    ownerID: 500010,
    corporationID: 500010,
    itemName: "Parity NPC Ship",
    position: { x: 500, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    mode: "STOP",
    speedFraction: 0,
  });
  assert.strictEqual(spawnResult.success, true, "Expected runtime ship spawn to succeed");

  const npcEntity = spawnResult.data.entity;
  const nearBubble = runtime.getBubbleForSession(nearSessionA);
  assert(nearBubble, "Expected near-session bubble");
  assert.strictEqual(npcEntity.bubbleID, nearBubble.id, "NPC should enter the near observers' bubble");

  const bubbleSessions = runtime.getSessionsInBubble(TEST_SYSTEM_ID, nearBubble.id);
  const bubbleShips = runtime.getShipsInBubble(TEST_SYSTEM_ID, nearBubble.id);
  assert.deepStrictEqual(
    bubbleSessions.map((session) => session.clientID).sort((left, right) => left - right),
    [nearSessionA.clientID, nearSessionB.clientID],
    "Only near sessions should be members of the NPC bubble",
  );
  assert(
    bubbleShips.some((entity) => entity.itemID === npcEntity.itemID),
    "Bubble ship query should include the spawned NPC ship",
  );

  const nearAddNames = flattenDestinyPayloadNames(nearSessionA.notifications);
  const nearPeerAddNames = flattenDestinyPayloadNames(nearSessionB.notifications);
  const farAddNames = flattenDestinyPayloadNames(farSession.notifications);
  assert(nearAddNames.includes("AddBalls2"), "Near observer A should receive AddBalls2");
  assert(nearPeerAddNames.includes("AddBalls2"), "Near observer B should receive AddBalls2");
  assert(
    !farAddNames.includes("AddBalls2"),
    "Far observer should not receive AddBalls2 outside the public grid",
  );

  nearSessionA.notifications.length = 0;
  nearSessionB.notifications.length = 0;
  farSession.notifications.length = 0;

  const bubbleFx = {
    stamp: 123456,
    payload: destiny.buildOnSpecialFXPayload(npcEntity.itemID, "effects.Warping", {
      active: false,
    }),
  };
  const bubbleBroadcastResult = runtime.broadcastDestinyUpdatesToBubble(
    TEST_SYSTEM_ID,
    nearBubble.id,
    [bubbleFx],
  );
  assert.strictEqual(
    bubbleBroadcastResult.deliveredCount,
    2,
    "Bubble broadcast should only reach sessions in that bubble",
  );

  const nearFxNames = flattenDestinyPayloadNames(nearSessionA.notifications);
  const nearPeerFxNames = flattenDestinyPayloadNames(nearSessionB.notifications);
  const farFxNames = flattenDestinyPayloadNames(farSession.notifications);
  assert(nearFxNames.includes("OnSpecialFX"), "Near observer A should receive bubble FX");
  assert(nearPeerFxNames.includes("OnSpecialFX"), "Near observer B should receive bubble FX");
  assert(!farFxNames.includes("OnSpecialFX"), "Far observer should not receive bubble FX");

  nearSessionA.notifications.length = 0;
  nearSessionB.notifications.length = 0;
  farSession.notifications.length = 0;

  const removeResult = runtime.removeDynamicEntity(TEST_SYSTEM_ID, npcEntity.itemID);
  assert.strictEqual(removeResult.success, true, "Expected runtime ship removal to succeed");

  const nearRemovalPayloads = collectDestinyPayloads(nearSessionA.notifications);
  const nearPeerRemovalPayloads = collectDestinyPayloads(nearSessionB.notifications);
  const farRemovalPayloads = collectDestinyPayloads(farSession.notifications);
  assert(
    nearRemovalPayloads.some((entry) => entry.name === "RemoveBalls"),
    "Near observer A should receive RemoveBalls",
  );
  assert(
    nearPeerRemovalPayloads.some((entry) => entry.name === "RemoveBalls"),
    "Near observer B should receive RemoveBalls",
  );
  assert.strictEqual(
    farRemovalPayloads.length,
    0,
    "Far observer should not receive removal for a ball it never saw",
  );

  runtime.detachSession(nearSessionA, { broadcast: false });
  runtime.detachSession(nearSessionB, { broadcast: false });
  runtime.detachSession(farSession, { broadcast: false });

  return {
    npcEntityID: npcEntity.itemID,
    nearBubbleID: nearBubble.id,
    nearBubbleUUID: nearBubble.uuid,
    publicGridBoxMeters: testing.PUBLIC_GRID_BOX_METERS,
    nearAddNames,
    nearFxNames,
    nearRemovalNames: nearRemovalPayloads.map((entry) => entry.name),
  };
}

function main() {
  const overlap = runBubbleOverlapCheck();
  const dynamicVisibility = runDynamicEntityVisibilityCheck();

  console.log(JSON.stringify({
    ok: true,
    overlap,
    dynamicVisibility,
  }, null, 2));
}

main();
