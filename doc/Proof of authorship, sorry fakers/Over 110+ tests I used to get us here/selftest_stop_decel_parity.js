/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const testing = runtime._testing;
const ISOLATED_ORIGIN = {
  x: testing.PUBLIC_GRID_BOX_METERS * 120,
  y: testing.PUBLIC_GRID_BOX_METERS * -41,
  z: testing.PUBLIC_GRID_BOX_METERS * 19,
};

function add(left, right) {
  return {
    x: Number(left.x || 0) + Number(right.x || 0),
    y: Number(left.y || 0) + Number(right.y || 0),
    z: Number(left.z || 0) + Number(right.z || 0),
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

function detachSessions(sessions) {
  for (const session of sessions) {
    try {
      runtime.detachSession(session, { broadcast: false });
    } catch (error) {
      // best-effort cleanup for selftest isolation
    }
  }
  runtime._testing.clearScenes();
}

function main() {
  runtime._testing.clearScenes();
  const pilotSession = createFakeSession(
    996301,
    997301,
    add(ISOLATED_ORIGIN, { x: 0, y: 0, z: 0 }),
    { x: 1, y: 0, z: 0 },
  );
  const observerSession = createFakeSession(
    996302,
    997302,
    add(ISOLATED_ORIGIN, { x: 500, y: 0, z: 0 }),
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
    assert(pilotEntity, "Expected pilot entity after attach");

    pilotEntity.mode = "GOTO";
    pilotEntity.speedFraction = 1;
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = add(ISOLATED_ORIGIN, { x: 500000, y: 0, z: 0 });
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };

    const stopResult = runtime.stop(pilotSession);
    assert.strictEqual(stopResult, true, "Expected stop command to succeed");

    const pilotImmediateNames = flattenDestinyPayloadNames(pilotSession.notifications);
    const observerImmediateNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(
      pilotImmediateNames.includes("SetSpeedFraction"),
      "Pilot should receive SetSpeedFraction on stop",
    );
    assert(
      pilotImmediateNames.includes("Stop"),
      "Pilot should receive Stop on stop",
    );
    assert(
      pilotImmediateNames.includes("SetBallVelocity"),
      "Pilot should receive immediate SetBallVelocity on stop",
    );
    assert(
      observerImmediateNames.includes("SetSpeedFraction"),
      "Observer should receive SetSpeedFraction on stop",
    );
    assert(
      observerImmediateNames.includes("Stop"),
      "Observer should receive Stop on stop",
    );
    assert(
      observerImmediateNames.includes("SetBallVelocity"),
      "Observer should receive immediate SetBallVelocity on stop",
    );

    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const wallclockNow = Date.now();
    scene.lastTickAt = wallclockNow - 250;
    scene.tick(wallclockNow);

    const pilotFollowUpNames = flattenDestinyPayloadNames(pilotSession.notifications);
    const observerFollowUpNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(
      !pilotFollowUpNames.includes("SetBallVelocity"),
      "Pilot should stay on the local stop contract instead of receiving follow-up stop decel SetBallVelocity",
    );
    assert(
      !observerFollowUpNames.includes("SetBallVelocity"),
      "Observer should stay on the local stop contract instead of receiving follow-up stop decel SetBallVelocity",
    );

    console.log(JSON.stringify({
      ok: true,
      pilotImmediateNames,
      observerImmediateNames,
      pilotFollowUpNames,
      observerFollowUpNames,
    }, null, 2));
  } finally {
    detachSessions([pilotSession, observerSession]);
  }
}

main();
