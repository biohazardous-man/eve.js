const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const {
  getCharacterRecord,
  getCharacterShips,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const ATTRIBUTE_CHARGE = 18;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = (getCharacterShips(characterID) || []).find((entry) => (
        Number(entry.flagID) === ITEM_FLAGS.HANGAR &&
        Number(entry.locationID || 0) > 0
      ));
      if (!characterRecord || !ship) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked ship candidate");
  return candidates[0];
}

function buildSession(candidate) {
  const notifications = [];
  const stationID = Number(
    candidate.characterRecord.stationID ||
    candidate.characterRecord.stationid ||
    candidate.ship.locationID ||
    0,
  );
  return {
    clientID: candidate.characterID + 9800,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.warFactionID) || 0,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    shipName: candidate.ship.itemName,
    stationid: stationID,
    locationid: stationID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function getNotificationItems(entry) {
  const payload = entry && Array.isArray(entry.payload)
    ? entry.payload[0]
    : null;
  if (payload && payload.type === "list" && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function collectCapacitorChanges(session, shipID) {
  const changes = [];
  for (const entry of session.notifications) {
    if (!entry || entry.name !== "OnModuleAttributeChanges") {
      continue;
    }
    for (const change of getNotificationItems(entry)) {
      if (
        Array.isArray(change) &&
        Number(change[2]) === Number(shipID) &&
        Number(change[3]) === ATTRIBUTE_CHARGE
      ) {
        changes.push(change);
      }
    }
  }
  return changes;
}

function fileTimeToMs(value) {
  const fileTime =
    typeof value === "bigint"
      ? value
      : BigInt(Math.trunc(Number(value) || 0));
  return Number((fileTime - FILETIME_EPOCH_OFFSET) / 10000n);
}

function main() {
  runtime._testing.clearScenes();

  const candidate = getCandidate();
  const session = buildSession(candidate);
  let attached = false;

  try {
    runtime.attachSession(session, candidate.ship, {
      systemID: 30000142,
      broadcast: false,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    attached = true;
    session._space.initialStateSent = true;

    const scene = runtime.getSceneForSession(session);
    const entity = scene.getShipEntityForSession(session);
    assert(entity, "Expected an attached ship entity");
    assert(
      Number(entity.capacitorCapacity) > 0 &&
      Number(entity.capacitorRechargeRate) > 0,
      "Expected ship capacitor stats to be present for cadence validation",
    );

    const setResult = runtime.setShipCapacitorRatio(session, 0.4);
    assert.strictEqual(setResult.success, true, "Expected capacitor setup to succeed");
    session.notifications.length = 0;

    const startMs = Date.now();
    scene.lastTickAt = startMs;
    for (let index = 0; index < 13; index += 1) {
      scene.tick(startMs + ((index + 1) * 100));
    }

    const capChanges = collectCapacitorChanges(session, candidate.ship.itemID);
    assert(
      capChanges.length >= 2,
      "Expected passive capacitor recharge to emit multiple charge updates",
    );
    assert(
      capChanges.length <= 3,
      "Expected passive capacitor recharge updates to stay throttled near the client's 500 ms HUD cadence",
    );

    let previousAmount = -Infinity;
    let previousTimeMs = null;
    for (const change of capChanges) {
      const chargeAmount = Number(change[5]);
      const timeMs = fileTimeToMs(change[4]);
      assert(
        chargeAmount > previousAmount,
        "Expected passive capacitor updates to increase capacitor charge monotonically",
      );
      if (previousTimeMs !== null) {
        assert(
          timeMs - previousTimeMs >= 450,
          "Expected passive capacitor charge notifications to stay near CCP's 500 ms HUD cadence",
        );
      }
      previousAmount = chargeAmount;
      previousTimeMs = timeMs;
    }

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      capacitorCapacity: entity.capacitorCapacity,
      capacitorRechargeRate: entity.capacitorRechargeRate,
      notificationCount: capChanges.length,
      notificationTimesMs: capChanges.map((change) => fileTimeToMs(change[4])),
      chargeAmounts: capChanges.map((change) => Number(change[5])),
    }, null, 2));
  } finally {
    if (attached && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
  }
}

main();
