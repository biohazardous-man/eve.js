/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

const TEST_SYSTEM_ID = 30000142;
const TEST_CLIENT_ID = 969100;
const TEST_CHARACTER_ID = 979100;
const REMOTE_ENTITY_ID = 989100;
const CLOCK_OFFSET_MS = 750;

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

function extractDestinyEntries(notifications) {
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

function readStateBufferStamp(buffer) {
  assert(Buffer.isBuffer(buffer), "expected a raw destiny state buffer");
  return buffer.readUInt32LE(1);
}

function getKeyValEntries(keyValObject) {
  return (
    keyValObject &&
    keyValObject.args &&
    Array.isArray(keyValObject.args.entries)
      ? keyValObject.args.entries
      : []
  );
}

function getKeyValValue(keyValObject, key) {
  const match = getKeyValEntries(keyValObject).find((entry) => entry[0] === key);
  return match ? match[1] : null;
}

function getAddBallsStateBuffer(entry) {
  return entry && entry.args && entry.args[0] ? entry.args[0][0] : null;
}

function getAddBallsFirstDamageFileTime(entry) {
  const extraBallDataList = entry && entry.args && entry.args[0] ? entry.args[0][1] : null;
  const firstExtraBallData =
    extraBallDataList && Array.isArray(extraBallDataList.items)
      ? extraBallDataList.items[0]
      : null;
  const damageState = Array.isArray(firstExtraBallData) ? firstExtraBallData[1] : null;
  const shieldState = Array.isArray(damageState) ? damageState[0] : null;
  const fileTime = Array.isArray(shieldState) ? shieldState[2] : null;
  return fileTime && typeof fileTime === "object" ? fileTime.value : null;
}

function main() {
  runtime._testing.clearScenes();

  let session = null;
  try {
    session = createFakeSession(
      TEST_CLIENT_ID,
      TEST_CHARACTER_ID,
      TEST_SYSTEM_ID,
      { x: -107303362560, y: -18744975360, z: 436489052160 },
      { x: 1, y: 0, z: 0 },
    );
    attachReadySession(session);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const remoteEntity = runtime._testing.buildRuntimeShipEntityForTesting({
      itemID: REMOTE_ENTITY_ID,
      typeID: 17726,
      ownerID: 140000002,
      corporationID: 1000044,
      itemName: "Clock Alignment Probe",
      position: {
        x: -107303361000,
        y: -18744975360,
        z: 436489052160,
      },
      direction: { x: -1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "FOLLOW",
      targetEntityID: session.shipItem.itemID,
      followRange: 2000,
      speedFraction: 1,
    }, TEST_SYSTEM_ID);
    assert.strictEqual(
      scene.spawnDynamicEntity(remoteEntity, { broadcast: false }).success,
      true,
      "expected remote entity spawn to succeed",
    );

    const fixedRawSimTimeMs = scene.getCurrentSimTimeMs();
    const fixedRawStamp = scene.getCurrentDestinyStamp(fixedRawSimTimeMs) + 10;
    const originalGetCurrentSimTimeMs = scene.getCurrentSimTimeMs.bind(scene);
    const originalGetNextDestinyStamp = scene.getNextDestinyStamp.bind(scene);
    scene.getCurrentSimTimeMs = () => fixedRawSimTimeMs;
    scene.getNextDestinyStamp = () => fixedRawStamp;

    session._space.clockOffsetMs = CLOCK_OFFSET_MS;
    scene.refreshSessionClockSnapshot(session, fixedRawSimTimeMs, {
      currentSimTimeMs: scene.getCurrentSessionSimTimeMs(session, fixedRawSimTimeMs),
    });

    const expectedAddBallsStamp = scene.translateDestinyStampForSession(
      session,
      fixedRawStamp,
    );
    const expectedSimFileTime = scene.getCurrentSessionFileTime(
      session,
      fixedRawSimTimeMs,
    );

    session.notifications.length = 0;
    scene.sendAddBallsToSession(session, [remoteEntity]);
    const addBallsEntries = extractDestinyEntries(session.notifications);
    const addBallsEntry = addBallsEntries.find((entry) => entry.name === "AddBalls2");
    assert(addBallsEntry, "expected AddBalls2 entry");
    assert.strictEqual(
      addBallsEntry.stamp,
      expectedAddBallsStamp,
      "AddBalls2 envelope stamp should be translated to the session clock",
    );
    assert.strictEqual(
      readStateBufferStamp(getAddBallsStateBuffer(addBallsEntry)),
      expectedAddBallsStamp,
      "AddBalls2 internal state-buffer stamp should match the session clock",
    );
    assert.strictEqual(
      getAddBallsFirstDamageFileTime(addBallsEntry),
      expectedSimFileTime,
      "AddBalls2 damage-state filetime should use the recipient session clock",
    );
    const expectedModeStamp = scene.translateDestinyStampForSession(
      session,
      fixedRawStamp + 1,
    );
    const followBallEntry = addBallsEntries.find((entry) => entry.name === "FollowBall");
    assert(followBallEntry, "expected follow bootstrap after AddBalls2");
    assert.strictEqual(
      followBallEntry.stamp,
      expectedModeStamp,
      "Moving-ball bootstrap should defer follow/orbit mode to the next session-clock stamp",
    );
    const speedFractionEntry = addBallsEntries.find((entry) => entry.name === "SetSpeedFraction");
    assert(speedFractionEntry, "expected speed fraction bootstrap after AddBalls2");
    assert.strictEqual(
      speedFractionEntry.stamp,
      expectedModeStamp,
      "Moving-ball speed bootstrap should defer to the same follow-up stamp as mode updates",
    );

    session.notifications.length = 0;
    const rawSetStateStamp = fixedRawStamp + 1;
    const expectedSetStateStamp = scene.translateDestinyStampForSession(
      session,
      rawSetStateStamp,
    );
    scene.sendStateRefresh(
      session,
      scene.getShipEntityForSession(session),
      rawSetStateStamp,
    );
    const setStateEntries = extractDestinyEntries(session.notifications);
    const setStateEntry = setStateEntries.find((entry) => entry.name === "SetState");
    assert(setStateEntry, "expected SetState entry");
    assert.strictEqual(
      setStateEntry.stamp,
      expectedSetStateStamp,
      "SetState envelope stamp should be translated to the session clock",
    );
    assert.strictEqual(
      getKeyValValue(setStateEntry.args[0], "stamp"),
      expectedSetStateStamp,
      "SetState payload stamp should be translated to the session clock",
    );
    assert.strictEqual(
      readStateBufferStamp(getKeyValValue(setStateEntry.args[0], "state")),
      expectedSetStateStamp,
      "SetState internal state-buffer stamp should match the session clock",
    );

    scene.getCurrentSimTimeMs = originalGetCurrentSimTimeMs;
    scene.getNextDestinyStamp = originalGetNextDestinyStamp;

    console.log(JSON.stringify({
      ok: true,
      clockOffsetMs: CLOCK_OFFSET_MS,
      expectedAddBallsStamp,
      expectedSetStateStamp,
      expectedSimFileTime: String(expectedSimFileTime),
    }, null, 2));
  } finally {
    if (session && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
  }
}

main();
setImmediate(() => process.exit(0));
