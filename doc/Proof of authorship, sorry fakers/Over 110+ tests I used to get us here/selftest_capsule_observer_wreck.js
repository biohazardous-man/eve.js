/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const {
  CAPSULE_TYPE_ID,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const shipDestruction = require(path.join(
  __dirname,
  "../../server/src/space/shipDestruction",
));

const TEST_SYSTEM_ID = 30000142;

function createObserverSession() {
  const notifications = [];
  return {
    clientID: 998110,
    characterID: 998111,
    charid: 998111,
    userid: 998111,
    characterName: "pod-observer",
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipID: 998112,
    shipid: 998112,
    activeShipID: 998112,
    shipTypeID: 606,
    shipName: "pod-observer-ship",
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
    shipItem: {
      itemID: 998112,
      typeID: 606,
      ownerID: 998111,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position: {
          x: -107303362560,
          y: -18744975360,
          z: 436489052160,
        },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
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

function flattenDestinyUpdates(notifications) {
  const updates = [];
  for (const notification of notifications || []) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }
    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function getOwnerCharacterID() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "failed to read characters");
  const characterID = Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .find((value) => value > 0);
  assert(characterID > 0, "expected at least one real character owner");
  return characterID;
}

function main() {
  runtime._testing.clearScenes();

  const ownerCharacterID = getOwnerCharacterID();
  const observerSession = createObserverSession();
  let wreckID = 0;

  try {
    attachReadySession(observerSession);
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(scene, "expected test scene");

    const capsuleSpawnResult = runtime.spawnDynamicShip(TEST_SYSTEM_ID, {
      typeID: CAPSULE_TYPE_ID,
      groupID: 29,
      categoryID: 6,
      itemName: "Observer Capsule Victim",
      ownerID: ownerCharacterID,
      characterID: 0,
      corporationID: 0,
      allianceID: 0,
      warFactionID: 0,
      position: {
        x: observerSession.shipItem.spaceState.position.x + 2_000,
        y: observerSession.shipItem.spaceState.position.y,
        z: observerSession.shipItem.spaceState.position.z,
      },
      direction: { x: -1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      targetPoint: {
        x: observerSession.shipItem.spaceState.position.x + 2_000,
        y: observerSession.shipItem.spaceState.position.y,
        z: observerSession.shipItem.spaceState.position.z,
      },
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    });
    assert.strictEqual(capsuleSpawnResult.success, true, "expected capsule spawn to succeed");
    const capsuleEntity = capsuleSpawnResult.data && capsuleSpawnResult.data.entity;
    assert(capsuleEntity, "expected live capsule entity");

    observerSession.notifications.length = 0;
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      capsuleEntity,
      {
        ownerCharacterID,
      },
    );
    assert.strictEqual(
      destroyResult.success,
      true,
      destroyResult.errorMsg || "expected capsule destruction to succeed",
    );

    wreckID = Number(destroyResult.data && destroyResult.data.wreck && destroyResult.data.wreck.itemID);
    assert(wreckID > 0, "expected capsule destruction to leave a wreck");
    const wreckEntity = scene.getEntityByID(wreckID);
    assert(wreckEntity && wreckEntity.kind === "wreck", "expected live capsule wreck entity");
    assert.strictEqual(
      Number(wreckEntity.launcherID),
      Number(capsuleEntity.itemID),
      "expected capsule wreck to point back at the destroyed pod ball",
    );

    const observerUpdates = flattenDestinyUpdates(observerSession.notifications);
    assert(
      observerUpdates.some((entry) => entry.name === "TerminalPlayDestructionEffect"),
      "expected observers to receive the pod destruction effect",
    );
    assert(
      observerUpdates.some((entry) => entry.name === "RemoveBalls"),
      "expected observers to receive pod RemoveBalls",
    );

    console.log(JSON.stringify({
      ok: true,
      capsuleID: capsuleEntity.itemID,
      wreckID,
      wreckTypeID: wreckEntity.typeID,
    }, null, 2));
  } finally {
    if (wreckID > 0) {
      runtime.destroyDynamicInventoryEntity(TEST_SYSTEM_ID, wreckID, {
        removeContents: true,
      });
    }
    if (observerSession._space) {
      runtime.detachSession(observerSession, { broadcast: false });
    }
    runtime._testing.clearScenes();
  }
}

main();
