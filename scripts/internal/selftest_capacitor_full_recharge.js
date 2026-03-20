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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeItemRecord(itemID, record) {
  const result = database.write("items", `/${itemID}`, record);
  assert(result.success, `Failed to restore item ${itemID}`);
}

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
  const stationID = Number(
    candidate.characterRecord.stationID ||
    candidate.characterRecord.stationid ||
    candidate.ship.locationID ||
    0,
  );
  return {
    clientID: candidate.characterID + 9900,
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
    sendNotification() {},
  };
}

function main() {
  runtime._testing.clearScenes();
  const candidate = getCandidate();
  const previousShipRecord = clone(candidate.ship);
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
    assert(entity, "Expected attached ship entity");
    assert(
      Number(entity.capacitorCapacity) > 1 &&
      Number(entity.capacitorRechargeRate) > 0,
      "Expected ship capacitor stats to be present",
    );

    const nearFullRatio = (Number(entity.capacitorCapacity) - 1) / Number(entity.capacitorCapacity);
    const setResult = runtime.setShipCapacitorRatio(session, nearFullRatio);
    assert.strictEqual(setResult.success, true, "Expected capacitor setup to succeed");

    const startMs = Date.now();
    scene.lastTickAt = startMs;
    scene.tick(startMs + 100);

    const capacitorState = runtime.getShipCapacitorState(session);
    assert(capacitorState, "Expected capacitor state after tick");
    assert.strictEqual(
      Number(capacitorState.amount),
      Number(capacitorState.capacity),
      "Expected passive recharge settle to snap the final visible capacitor unit",
    );
    assert.strictEqual(Number(capacitorState.ratio), 1, "Expected full capacitor ratio");

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      capacity: capacitorState.capacity,
      amount: capacitorState.amount,
      ratio: capacitorState.ratio,
    }, null, 2));
  } finally {
    if (attached && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
    writeItemRecord(candidate.ship.itemID, previousShipRecord);
  }
}

main();
