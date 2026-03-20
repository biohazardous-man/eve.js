const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const WARP_TARGET = { x: 3.0e12, y: 0, z: 0 };

function createFakeSession(clientID, characterID, position, direction) {
  const notifications = [];
  return {
    clientID,
    characterID,
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

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
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
  session._space.initialStateSent = true;
  session.notifications.length = 0;
}

function detachSession(session) {
  try {
    runtime.detachSession(session, { broadcast: false });
  } catch (error) {
    // best-effort cleanup for selftest isolation
  }
}

function testStopCancelsPreparingWarp() {
  const session = createFakeSession(
    996401,
    997401,
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );

  attachReadySession(session);

  try {
    const scene = runtime.getSceneForSession(session);
    assert(scene, "Expected scene for preparing-warp stop test");
    const entity = scene.getShipEntityForSession(session);
    assert(entity, "Expected entity for preparing-warp stop test");

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    entity.direction = { x: 1, y: 0, z: 0 };
    entity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    entity.speedFraction = 1;
    entity.mode = "STOP";

    const warpResult = runtime.warpToPoint(session, WARP_TARGET, {
      targetEntityID: 40009118,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true, "Expected warp request to succeed");
    assert(entity.pendingWarp, "Preparing warp should create pendingWarp");

    entity.pendingWarp.requestedAtMs = baseNow;
    session.notifications.length = 0;
    scene.tick(baseNow);
    assert(entity.pendingWarp, "Warp should still be in prepare phase before stop");

    session.notifications.length = 0;
    const stopResult = runtime.stop(session);
    assert.strictEqual(stopResult, true, "Expected stop to cancel preparing warp");
    assert.strictEqual(entity.mode, "STOP", "Preparing warp stop should leave ship stopped");
    assert.strictEqual(entity.pendingWarp, null, "Preparing warp stop should clear pendingWarp");
    assert.strictEqual(entity.warpState, null, "Preparing warp stop should clear preparing warpState");

    const payloadNames = flattenDestinyPayloadNames(session.notifications);
    assert(
      payloadNames.includes("SetSpeedFraction"),
      "Preparing warp stop should send SetSpeedFraction",
    );
    assert(
      payloadNames.includes("Stop"),
      "Preparing warp stop should send Stop",
    );

    session.notifications.length = 0;
    scene.lastTickAt = baseNow;
    scene.tick(baseNow + 1000);
    assert.strictEqual(entity.mode, "STOP", "Cancelled preparing warp should stay stopped");
    assert.strictEqual(entity.pendingWarp, null, "Cancelled preparing warp should not reactivate");
    assert.strictEqual(entity.warpState, null, "Cancelled preparing warp should not rebuild warpState");

    return {
      payloadNames,
    };
  } finally {
    detachSession(session);
    runtime._testing.clearScenes();
  }
}

function testStopIgnoredDuringActiveWarp() {
  const session = createFakeSession(
    996402,
    997402,
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );

  attachReadySession(session);

  try {
    const scene = runtime.getSceneForSession(session);
    assert(scene, "Expected scene for active-warp stop test");
    const entity = scene.getShipEntityForSession(session);
    assert(entity, "Expected entity for active-warp stop test");

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    entity.direction = { x: 1, y: 0, z: 0 };
    entity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    entity.speedFraction = 1;
    entity.mode = "STOP";

    const warpResult = runtime.warpToPoint(session, WARP_TARGET, {
      targetEntityID: 40009119,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true, "Expected warp request to succeed");
    assert(entity.pendingWarp, "Active warp test should start with pendingWarp");

    entity.pendingWarp.requestedAtMs = baseNow - 30000;
    session.notifications.length = 0;
    scene.tick(baseNow);

    assert.strictEqual(entity.mode, "WARP", "Ship should enter active warp before stop");
    assert(entity.warpState, "Active warp stop test should have warpState");
    assert.strictEqual(entity.pendingWarp, null, "Active warp should clear pendingWarp on activation");

    const previousPosition = { ...entity.position };
    const previousWarpState = entity.warpState;
    const previousTargetPoint = { ...entity.targetPoint };
    const previousVelocity = { ...entity.velocity };

    session.notifications.length = 0;
    const stopResult = runtime.stop(session);
    assert.strictEqual(stopResult, false, "Expected stop to be ignored during active warp");
    assert.strictEqual(entity.mode, "WARP", "Active warp stop should leave mode unchanged");
    assert.strictEqual(entity.warpState, previousWarpState, "Active warp stop should preserve warpState");
    assert.deepStrictEqual(
      entity.targetPoint,
      previousTargetPoint,
      "Active warp stop should preserve targetPoint",
    );
    assert.deepStrictEqual(
      entity.velocity,
      previousVelocity,
      "Active warp stop should preserve velocity",
    );
    assert.deepStrictEqual(
      flattenDestinyPayloadNames(session.notifications),
      [],
      "Active warp stop should not emit stop updates",
    );

    session.notifications.length = 0;
    scene.lastTickAt = baseNow;
    scene.tick(baseNow + 1000);
    assert.strictEqual(entity.mode, "WARP", "Ship should remain in warp after ignored stop");
    assert(entity.warpState, "Ship should still have warpState after ignored stop");
    assert(
      entity.position.x > previousPosition.x,
      "Ship should keep advancing through warp after ignored stop",
    );

    return {
      ignoredPayloadNames: flattenDestinyPayloadNames(session.notifications),
    };
  } finally {
    detachSession(session);
    runtime._testing.clearScenes();
  }
}

function main() {
  runtime._testing.clearScenes();

  const preparingWarp = testStopCancelsPreparingWarp();
  const activeWarp = testStopIgnoredDuringActiveWarp();

  console.log(JSON.stringify({
    ok: true,
    preparingWarp,
    activeWarp,
  }, null, 2));
}

main();
