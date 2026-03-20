const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const testing = runtime._testing;
const JITA_MAURASI_GATE_ID = 50001248;
const JITA_PERIMETER_GATE_ID = 50001249;
const ISOLATED_PUBLIC_GRID_ORIGIN = {
  x: testing.PUBLIC_GRID_BOX_METERS * 100,
  y: testing.PUBLIC_GRID_BOX_METERS * 37,
  z: testing.PUBLIC_GRID_BOX_METERS * -53,
};

function buildIsolatedPosition(xOffset = 0, yOffset = 0, zOffset = 0) {
  return {
    x: ISOLATED_PUBLIC_GRID_ORIGIN.x + xOffset,
    y: ISOLATED_PUBLIC_GRID_ORIGIN.y + yOffset,
    z: ISOLATED_PUBLIC_GRID_ORIGIN.z + zOffset,
  };
}

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

function attachReadySession(session, options = {}) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
  session._space.initialStateSent = true;
  if (options.clearNotifications !== false) {
    session.notifications.length = 0;
  }
}

function detachSessions(sessions) {
  for (const session of sessions) {
    try {
      runtime.detachSession(session, { broadcast: false });
    } catch (error) {
      // best effort cleanup for selftest isolation
    }
  }
  runtime._testing.clearScenes();
}

function runCrossBubbleSameGridVisibilityCheck() {
  runtime._testing.clearScenes();
  const gridBase = buildIsolatedPosition(1000, 0, 0);
  const nearSession = createFakeSession(
    995001,
    996001,
    gridBase,
    { x: 1, y: 0, z: 0 },
  );
  const sameGridFarSession = createFakeSession(
    995002,
    996002,
    buildIsolatedPosition(4_000_000, 0, 0),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(nearSession);
    attachReadySession(sameGridFarSession);
    nearSession.notifications.length = 0;
    sameGridFarSession.notifications.length = 0;

    const spawnResult = runtime.spawnDynamicShip(TEST_SYSTEM_ID, {
      itemID: 995500001,
      typeID: 606,
      ownerID: 500010,
      corporationID: 500010,
      itemName: "Public Grid NPC",
      position: buildIsolatedPosition(1500, 0, 0),
      direction: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    });
    assert.strictEqual(spawnResult.success, true);

    const scene = runtime.getSceneForSession(nearSession);
    const npcEntity = spawnResult.data.entity;
    const nearEntity = scene.getShipEntityForSession(nearSession);
    const farEntity = scene.getShipEntityForSession(sameGridFarSession);
    assert(nearEntity && farEntity && npcEntity);
    assert.notStrictEqual(
      nearEntity.bubbleID,
      farEntity.bubbleID,
      "Sessions should still sit in different internal bubbles",
    );
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(nearEntity),
      scene.getPublicGridKeyForEntity(farEntity),
      "Sessions should share the same public grid",
    );
    assert.strictEqual(
      scene.canSessionSeeDynamicEntity(sameGridFarSession, npcEntity),
      true,
      "Same-grid observer should see cross-bubble dynamic entities",
    );

    const farNames = flattenDestinyPayloadNames(sameGridFarSession.notifications);
    assert(farNames.includes("AddBalls2"));

    return {
      publicGridBoxMeters: testing.PUBLIC_GRID_BOX_METERS,
      nearBubbleID: nearEntity.bubbleID,
      farBubbleID: farEntity.bubbleID,
      farNames,
    };
  } finally {
    detachSessions([nearSession, sameGridFarSession]);
  }
}

function runSameGridWarpContinuityCheck() {
  runtime._testing.clearScenes();
  const gridBase = buildIsolatedPosition(0, testing.PUBLIC_GRID_BOX_METERS * 2, 0);
  const pilotSession = createFakeSession(
    995101,
    996101,
    add(gridBase, { x: 0, y: 1000, z: 0 }),
    { x: 1, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    995102,
    996102,
    add(gridBase, { x: 1000, y: 1000, z: 0 }),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(pilotSession);
    attachReadySession(observerSession);
    pilotSession._space.visibleDynamicEntityIDs = new Set([observerSession.shipItem.itemID]);
    observerSession._space.visibleDynamicEntityIDs = new Set([pilotSession.shipItem.itemID]);
    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const scene = runtime.getSceneForSession(pilotSession);
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity);
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = add(gridBase, { x: 3_000_000, y: 1000, z: 0 });
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    const warpResult = runtime.warpToPoint(
      pilotSession,
      add(gridBase, { x: 3_000_000, y: 1000, z: 0 }),
      { targetEntityID: 40009501, stopDistance: 0, warpSpeedAU: 3 },
    );
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp);
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    observerSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");

    observerSession.notifications.length = 0;
    scene.tick(baseNow + 2500);
    const afterGraceNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(
      !afterGraceNames.includes("RemoveBalls"),
      "Same-grid warp should not despawn the ship for the observer",
    );
    assert(
      scene.canSessionSeeDynamicEntity(observerSession, pilotEntity, baseNow + 2500),
      "Observer should still see the ship while both remain in the same public grid",
    );

    return {
      afterGraceNames,
      stillVisibleAfter2500ms: true,
    };
  } finally {
    detachSessions([pilotSession, observerSession]);
  }
}

function runDestinationGridWarpInCheck() {
  runtime._testing.clearScenes();
  const warpTarget = buildIsolatedPosition(testing.PUBLIC_GRID_BOX_METERS * 2.5, 0, 0);
  const pilotSession = createFakeSession(
    995201,
    996201,
    buildIsolatedPosition(0, 0, 0),
    { x: 1, y: 0, z: 0 },
  );
  const destinationObserverSession = createFakeSession(
    995202,
    996202,
    buildIsolatedPosition((testing.PUBLIC_GRID_BOX_METERS * 2.5) + 1000, 0, 0),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(pilotSession);
    attachReadySession(destinationObserverSession);
    destinationObserverSession.notifications.length = 0;

    const scene = runtime.getSceneForSession(pilotSession);
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity);
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    const warpResult = runtime.warpToPoint(pilotSession, warpTarget, {
      targetEntityID: 40009502,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp);
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    destinationObserverSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");
    assert.deepStrictEqual(
      flattenDestinyPayloadNames(destinationObserverSession.notifications),
      [],
      "Destination observer should not see the ship before it enters the destination public grid",
    );

    const completionNow = Math.ceil(
      pilotEntity.warpState.startTimeMs + pilotEntity.warpState.durationMs + 50,
    );
    let firstWarpInAt = null;
    let firstWarpInNames = [];
    destinationObserverSession.notifications.length = 0;
    for (let tickNow = baseNow + 250; tickNow < completionNow; tickNow += 250) {
      scene.tick(tickNow);
      const names = flattenDestinyPayloadNames(destinationObserverSession.notifications);
      if (names.includes("AddBalls2")) {
        firstWarpInAt = tickNow;
        firstWarpInNames = names;
        break;
      }
    }

    assert(firstWarpInAt !== null, "Destination observer should gain visibility before landing");
    assert(firstWarpInNames.includes("EntityWarpIn"));
    assert(
      !firstWarpInNames.includes("WarpTo"),
      "Destination observer should not receive the departure WarpTo contract on mid-warp acquisition",
    );
    assert.strictEqual(
      pilotEntity.mode,
      "WARP",
      "Ship should still be in warp when destination observer first sees it",
    );

    destinationObserverSession.notifications.length = 0;
    scene.tick(completionNow);
    const completionNames = flattenDestinyPayloadNames(
      destinationObserverSession.notifications,
    );
    assert(
      !completionNames.includes("AddBalls2"),
      "Landing should not look like a fresh spawn if the ship was already visible in warp",
    );
    assert(completionNames.includes("SetBallPosition"));
    assert(completionNames.includes("Stop"));

    return {
      firstWarpInAt,
      firstWarpInNames,
      completionNames,
    };
  } finally {
    detachSessions([pilotSession, destinationObserverSession]);
  }
}

function add(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function getStaticEntityPosition(systemID, itemID) {
  const scene = runtime.ensureScene(systemID);
  const entity = scene.staticEntities.find(
    (candidate) => Number(candidate.itemID) === Number(itemID),
  );
  assert(entity && entity.position, `Missing static entity ${itemID}`);
  return entity.position;
}

function runComposedMultiBoxVisibilityCheck() {
  runtime._testing.clearScenes();
  const leftSession = createFakeSession(
    995301,
    996301,
    buildIsolatedPosition(1000, testing.PUBLIC_GRID_BOX_METERS * 4, 0),
    { x: 1, y: 0, z: 0 },
  );
  const bridgeSession = createFakeSession(
    995302,
    996302,
    buildIsolatedPosition(testing.PUBLIC_GRID_BOX_METERS + 1000, testing.PUBLIC_GRID_BOX_METERS * 4, 0),
    { x: -1, y: 0, z: 0 },
  );
  const rightSession = createFakeSession(
    995303,
    996303,
    buildIsolatedPosition((testing.PUBLIC_GRID_BOX_METERS * 2) + 1000, testing.PUBLIC_GRID_BOX_METERS * 4, 0),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(leftSession);
    attachReadySession(bridgeSession);
    attachReadySession(rightSession);
    leftSession.notifications.length = 0;
    bridgeSession.notifications.length = 0;
    rightSession.notifications.length = 0;

    const spawnResult = runtime.spawnDynamicShip(TEST_SYSTEM_ID, {
      itemID: 995500101,
      typeID: 606,
      ownerID: 500010,
      corporationID: 500010,
      itemName: "Composed Public Grid NPC",
      position: buildIsolatedPosition(1500, testing.PUBLIC_GRID_BOX_METERS * 4, 0),
      direction: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    });
    assert.strictEqual(spawnResult.success, true);

    const scene = runtime.getSceneForSession(leftSession);
    const npcEntity = spawnResult.data.entity;
    const leftEntity = scene.getShipEntityForSession(leftSession);
    const bridgeEntity = scene.getShipEntityForSession(bridgeSession);
    const rightEntity = scene.getShipEntityForSession(rightSession);
    assert(leftEntity && bridgeEntity && rightEntity && npcEntity);
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(leftEntity),
      "100:41:-53",
    );
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(bridgeEntity),
      "101:41:-53",
    );
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(rightEntity),
      "102:41:-53",
    );
    assert.strictEqual(
      scene.getPublicGridClusterKeyForEntity(leftEntity),
      scene.getPublicGridClusterKeyForEntity(rightEntity),
      "Connected occupied boxes should compose into one visible public grid",
    );
    assert.strictEqual(
      scene.canSessionSeeDynamicEntity(rightSession, npcEntity),
      true,
      "Far observer should see left-box NPC through the composed giant grid",
    );

    const rightNames = flattenDestinyPayloadNames(rightSession.notifications);
    assert(rightNames.includes("AddBalls2"));

    return {
      leftBox: scene.getPublicGridKeyForEntity(leftEntity),
      bridgeBox: scene.getPublicGridKeyForEntity(bridgeEntity),
      rightBox: scene.getPublicGridKeyForEntity(rightEntity),
      clusterKey: scene.getPublicGridClusterKeyForEntity(leftEntity),
      rightNames,
    };
  } finally {
    detachSessions([leftSession, bridgeSession, rightSession]);
  }
}

function runDiagonalBoxesDoNotComposeCheck() {
  runtime._testing.clearScenes();
  const leftSession = createFakeSession(
    995351,
    996351,
    buildIsolatedPosition(1000, testing.PUBLIC_GRID_BOX_METERS * 5, 0),
    { x: 1, y: 0, z: 0 },
  );
  const diagonalSession = createFakeSession(
    995352,
    996352,
    buildIsolatedPosition(
      testing.PUBLIC_GRID_BOX_METERS + 1000,
      testing.PUBLIC_GRID_BOX_METERS * 6,
      0,
    ),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(leftSession);
    attachReadySession(diagonalSession);
    leftSession.notifications.length = 0;
    diagonalSession.notifications.length = 0;

    const spawnResult = runtime.spawnDynamicShip(TEST_SYSTEM_ID, {
      itemID: 995500151,
      typeID: 606,
      ownerID: 500010,
      corporationID: 500010,
      itemName: "Diagonal Public Grid NPC",
      position: buildIsolatedPosition(1500, testing.PUBLIC_GRID_BOX_METERS * 5, 0),
      direction: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    });
    assert.strictEqual(spawnResult.success, true);

    const scene = runtime.getSceneForSession(leftSession);
    const npcEntity = spawnResult.data.entity;
    const leftEntity = scene.getShipEntityForSession(leftSession);
    const diagonalEntity = scene.getShipEntityForSession(diagonalSession);
    assert(leftEntity && diagonalEntity && npcEntity);
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(leftEntity),
      "100:42:-53",
    );
    assert.strictEqual(
      scene.getPublicGridKeyForEntity(diagonalEntity),
      "101:43:-53",
    );
    assert.notStrictEqual(
      scene.getPublicGridClusterKeyForEntity(leftEntity),
      scene.getPublicGridClusterKeyForEntity(diagonalEntity),
      "Diagonal-only occupied boxes should not compose into one giant grid",
    );
    assert.strictEqual(
      scene.canSessionSeeDynamicEntity(diagonalSession, npcEntity),
      false,
      "Diagonal-only occupancy should not leak visibility across giant grids",
    );

    const diagonalNames = flattenDestinyPayloadNames(diagonalSession.notifications);
    assert(
      !diagonalNames.includes("AddBalls2"),
      "Diagonal-only observers should not receive bootstrap AddBalls2 for left-box entities",
    );

    return {
      leftBox: scene.getPublicGridKeyForEntity(leftEntity),
      diagonalBox: scene.getPublicGridKeyForEntity(diagonalEntity),
      leftCluster: scene.getPublicGridClusterKeyForEntity(leftEntity),
      diagonalCluster: scene.getPublicGridClusterKeyForEntity(diagonalEntity),
      diagonalNames,
    };
  } finally {
    detachSessions([leftSession, diagonalSession]);
  }
}

function runJitaGateBootstrapVisibilityCheck() {
  runtime._testing.clearScenes();
  const maurasiPosition = add(
    getStaticEntityPosition(TEST_SYSTEM_ID, JITA_MAURASI_GATE_ID),
    { x: 25_000, y: 0, z: 0 },
  );
  const perimeterPosition = add(
    getStaticEntityPosition(TEST_SYSTEM_ID, JITA_PERIMETER_GATE_ID),
    { x: -25_000, y: 0, z: 0 },
  );
  const maurasiSession = createFakeSession(
    995361,
    996361,
    maurasiPosition,
    { x: 1, y: 0, z: 0 },
  );
  const perimeterSession = createFakeSession(
    995362,
    996362,
    perimeterPosition,
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(maurasiSession);
    maurasiSession.notifications.length = 0;
    attachReadySession(perimeterSession, { clearNotifications: false });

    const maurasiNames = flattenDestinyPayloadNames(maurasiSession.notifications);
    const perimeterNames = flattenDestinyPayloadNames(perimeterSession.notifications);
    const scene = runtime.getSceneForSession(maurasiSession);
    const maurasiEntity = scene.getShipEntityForSession(maurasiSession);
    const perimeterEntity = scene.getShipEntityForSession(perimeterSession);
    assert(maurasiEntity && perimeterEntity);
    assert.notStrictEqual(
      scene.getPublicGridClusterKeyForEntity(maurasiEntity),
      scene.getPublicGridClusterKeyForEntity(perimeterEntity),
      "Maurasi and Perimeter should not compose into the same giant grid at login bootstrap",
    );
    assert.strictEqual(
      scene.canSessionSeeDynamicEntity(maurasiSession, perimeterEntity),
      false,
      "Maurasi observer should not see a Perimeter login bootstrap target",
    );
    assert.strictEqual(
      scene.canSessionSeeDynamicEntity(perimeterSession, maurasiEntity),
      false,
      "Perimeter observer should not see a Maurasi login bootstrap target",
    );
    assert(
      maurasiNames.length === 0,
      "Maurasi should not receive any dynamic follow-up when Perimeter logs in off-grid",
    );
    assert(
      !(
        perimeterSession._space.visibleDynamicEntityIDs instanceof Set &&
        perimeterSession._space.visibleDynamicEntityIDs.has(maurasiEntity.itemID)
      ),
      "Perimeter bootstrap should not register the Maurasi ship as visible",
    );

    return {
      maurasiBox: scene.getPublicGridKeyForEntity(maurasiEntity),
      perimeterBox: scene.getPublicGridKeyForEntity(perimeterEntity),
      maurasiCluster: scene.getPublicGridClusterKeyForEntity(maurasiEntity),
      perimeterCluster: scene.getPublicGridClusterKeyForEntity(perimeterEntity),
      maurasiNames,
      perimeterNames,
      perimeterVisibleDynamicEntityIDs: [
        ...(perimeterSession._space.visibleDynamicEntityIDs || []),
      ],
    };
  } finally {
    detachSessions([maurasiSession, perimeterSession]);
  }
}

function runComposedWarpContinuityCheck() {
  runtime._testing.clearScenes();
  const pilotSession = createFakeSession(
    995401,
    996401,
    buildIsolatedPosition(1000, testing.PUBLIC_GRID_BOX_METERS * 6, 0),
    { x: 1, y: 0, z: 0 },
  );
  const originObserverSession = createFakeSession(
    995402,
    996402,
    buildIsolatedPosition(2000, testing.PUBLIC_GRID_BOX_METERS * 6, 0),
    { x: -1, y: 0, z: 0 },
  );
  const bridgeSession = createFakeSession(
    995403,
    996403,
    buildIsolatedPosition(testing.PUBLIC_GRID_BOX_METERS + 1000, testing.PUBLIC_GRID_BOX_METERS * 6, 0),
    { x: -1, y: 0, z: 0 },
  );
  const destinationObserverSession = createFakeSession(
    995404,
    996404,
    buildIsolatedPosition((testing.PUBLIC_GRID_BOX_METERS * 2) + 1000, testing.PUBLIC_GRID_BOX_METERS * 6, 0),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(pilotSession);
    attachReadySession(originObserverSession);
    attachReadySession(bridgeSession);
    attachReadySession(destinationObserverSession);
    pilotSession._space.visibleDynamicEntityIDs = new Set([
      originObserverSession.shipItem.itemID,
      bridgeSession.shipItem.itemID,
      destinationObserverSession.shipItem.itemID,
    ]);
    originObserverSession._space.visibleDynamicEntityIDs = new Set([
      pilotSession.shipItem.itemID,
      bridgeSession.shipItem.itemID,
      destinationObserverSession.shipItem.itemID,
    ]);
    bridgeSession._space.visibleDynamicEntityIDs = new Set([
      pilotSession.shipItem.itemID,
      originObserverSession.shipItem.itemID,
      destinationObserverSession.shipItem.itemID,
    ]);
    destinationObserverSession._space.visibleDynamicEntityIDs = new Set([
      pilotSession.shipItem.itemID,
      originObserverSession.shipItem.itemID,
      bridgeSession.shipItem.itemID,
    ]);
    originObserverSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;

    const scene = runtime.getSceneForSession(pilotSession);
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity);
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = buildIsolatedPosition(
      (testing.PUBLIC_GRID_BOX_METERS * 2) + 2000,
      testing.PUBLIC_GRID_BOX_METERS * 6,
      0,
    );
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    const warpResult = runtime.warpToPoint(
      pilotSession,
      pilotEntity.targetPoint,
      { targetEntityID: 40009503, stopDistance: 0, warpSpeedAU: 3 },
    );
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp);
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    originObserverSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");
    const activationOriginNames = flattenDestinyPayloadNames(originObserverSession.notifications);
    assert(
      activationOriginNames.includes("WarpTo"),
      "Origin observer should receive the normal warp-out command stream at activation",
    );
    assert(
      !activationOriginNames.includes("EntityWarpIn"),
      "Origin observer should not be treated like a fresh mid-warp acquisition",
    );
    assert(
      !activationOriginNames.includes("RemoveBalls"),
      "Origin observer should not lose the ship on the activation tick",
    );

    originObserverSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;
    scene.tick(baseNow + 2500);
    const originNames = flattenDestinyPayloadNames(originObserverSession.notifications);
    const destinationNames = flattenDestinyPayloadNames(destinationObserverSession.notifications);
    assert(
      !originNames.includes("RemoveBalls"),
      "Origin observer should not lose the ship while the composed giant grid remains connected",
    );
    assert(
      scene.canSessionSeeDynamicEntity(originObserverSession, pilotEntity, baseNow + 2500),
      "Origin observer should still see the warping ship while the composed grid is connected",
    );
    assert(
      destinationNames.length > 0 || scene.canSessionSeeDynamicEntity(destinationObserverSession, pilotEntity, baseNow + 2500),
      "Destination observer should be on the same composed grid during the warp continuity check",
    );

    return {
      activationOriginNames,
      originNames,
      destinationNames,
      stillVisibleToOriginObserver: true,
    };
  } finally {
    detachSessions([
      pilotSession,
      originObserverSession,
      bridgeSession,
      destinationObserverSession,
    ]);
  }
}

function runCrossGridWarpDropOffCheck() {
  runtime._testing.clearScenes();
  const pilotSession = createFakeSession(
    995501,
    996501,
    buildIsolatedPosition(1000, testing.PUBLIC_GRID_BOX_METERS * 8, 0),
    { x: 1, y: 0, z: 0 },
  );
  const originObserverSession = createFakeSession(
    995502,
    996502,
    buildIsolatedPosition(2000, testing.PUBLIC_GRID_BOX_METERS * 8, 0),
    { x: -1, y: 0, z: 0 },
  );
  const destinationObserverSession = createFakeSession(
    995503,
    996503,
    buildIsolatedPosition(testing.PUBLIC_GRID_BOX_METERS * 3 + 1000, testing.PUBLIC_GRID_BOX_METERS * 8, 0),
    { x: -1, y: 0, z: 0 },
  );

  try {
    attachReadySession(pilotSession);
    attachReadySession(originObserverSession);
    attachReadySession(destinationObserverSession);
    pilotSession._space.visibleDynamicEntityIDs = new Set([originObserverSession.shipItem.itemID]);
    originObserverSession._space.visibleDynamicEntityIDs = new Set([pilotSession.shipItem.itemID]);
    destinationObserverSession._space.visibleDynamicEntityIDs = new Set();

    const scene = runtime.getSceneForSession(pilotSession);
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity);
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = buildIsolatedPosition(
      (testing.PUBLIC_GRID_BOX_METERS * 3) + 2000,
      testing.PUBLIC_GRID_BOX_METERS * 8,
      0,
    );
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    scene.lastTickAt = baseNow - 50;
    const warpResult = runtime.warpToPoint(
      pilotSession,
      pilotEntity.targetPoint,
      { targetEntityID: 40009504, stopDistance: 0, warpSpeedAU: 3 },
    );
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp);
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    originObserverSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");
    const activationOriginNames = flattenDestinyPayloadNames(originObserverSession.notifications);
    assert(activationOriginNames.includes("WarpTo"));
    assert(!activationOriginNames.includes("RemoveBalls"));

    const completionNow = Math.ceil(
      pilotEntity.warpState.startTimeMs + pilotEntity.warpState.durationMs + 50,
    );
    let removeAt = null;
    let removeNames = [];
    let destinationAcquireAt = null;
    let destinationAcquireNames = [];
    for (let tickNow = baseNow + 250; tickNow < completionNow; tickNow += 250) {
      originObserverSession.notifications.length = 0;
      destinationObserverSession.notifications.length = 0;
      scene.tick(tickNow);
      const originNames = flattenDestinyPayloadNames(originObserverSession.notifications);
      const destinationNames = flattenDestinyPayloadNames(
        destinationObserverSession.notifications,
      );
      if (removeAt === null && originNames.includes("RemoveBalls")) {
        removeAt = tickNow;
        removeNames = originNames;
      }
      if (destinationAcquireAt === null && destinationNames.includes("AddBalls2")) {
        destinationAcquireAt = tickNow;
        destinationAcquireNames = destinationNames;
      }
      if (removeAt !== null && destinationAcquireAt !== null) {
        break;
      }
    }

    assert(removeAt !== null, "Origin observer should lose the ship once it exits the public grid");
    assert(destinationAcquireAt !== null, "Destination observer should acquire the ship before landing");
    assert(
      !scene.canSessionSeeDynamicEntity(originObserverSession, pilotEntity, removeAt),
      "Origin observer should no longer see the ship after the cross-grid drop-off",
    );
    assert(destinationAcquireNames.includes("EntityWarpIn"));

    return {
      activationOriginNames,
      removeAt,
      removeNames,
      destinationAcquireAt,
      destinationAcquireNames,
    };
  } finally {
    detachSessions([
      pilotSession,
      originObserverSession,
      destinationObserverSession,
    ]);
  }
}

function main() {
  const crossBubbleSameGrid = runCrossBubbleSameGridVisibilityCheck();
  const sameGridWarpContinuity = runSameGridWarpContinuityCheck();
  const destinationGridWarpIn = runDestinationGridWarpInCheck();
  const composedMultiBoxVisibility = runComposedMultiBoxVisibilityCheck();
  const diagonalBoxesDoNotCompose = runDiagonalBoxesDoNotComposeCheck();
  const composedWarpContinuity = runComposedWarpContinuityCheck();
  const crossGridWarpDropOff = runCrossGridWarpDropOffCheck();
  const jitaGateBootstrapVisibility = runJitaGateBootstrapVisibilityCheck();

  console.log(JSON.stringify({
    ok: true,
    crossBubbleSameGrid,
    sameGridWarpContinuity,
    destinationGridWarpIn,
    composedMultiBoxVisibility,
    diagonalBoxesDoNotCompose,
    composedWarpContinuity,
    crossGridWarpDropOff,
    jitaGateBootstrapVisibility,
  }, null, 2));
}

main();
