const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
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

function writeRecord(table, key, value) {
  const result = database.write(table, key, value);
  assert(result.success, `Failed to write ${table}${key}`);
}

function buildLoginStyleSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 10800,
    userid: characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship) {
        return null;
      }

      const stationID = Number(characterRecord.stationID || 0);
      if (
        stationID <= 0 ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR ||
        Number(ship.locationID) !== stationID
      ) {
        return null;
      }

      return {
        characterID,
        stationID,
        characterRecord,
        ship,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected at least one docked character");
  return candidates[0];
}

function main() {
  const candidate = getDockedCandidate();
  const rawCharacterResult = database.read("characters", `/${candidate.characterID}`);
  const rawShipResult = database.read("items", `/${candidate.ship.itemID}`);
  assert(rawCharacterResult.success, "Expected raw character record");
  assert(rawShipResult.success, "Expected raw ship record");

  const originalCharacter = clone(rawCharacterResult.data);
  const originalShip = clone(rawShipResult.data);

  try {
    writeRecord("characters", `/${candidate.characterID}`, {
      ...clone(originalCharacter),
      stationID: null,
      solarSystemID: Number(candidate.characterRecord.solarSystemID) || 30000142,
    });
    writeRecord("items", `/${candidate.ship.itemID}`, {
      ...clone(originalShip),
      locationID: candidate.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      spaceState: null,
    });

    const repairedRecord = getCharacterRecord(candidate.characterID);
    assert(repairedRecord, "Expected repaired character record");
    assert.strictEqual(
      Number(repairedRecord.stationID),
      candidate.stationID,
      "Expected active ship location to repair character stationID",
    );
    assert.strictEqual(
      Number(repairedRecord.solarSystemID),
      Number(candidate.characterRecord.solarSystemID),
      "Expected repaired character to keep the station's solar system",
    );

    const session = buildLoginStyleSession(candidate.characterID);
    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: true,
      logSelection: false,
    });
    assert.strictEqual(applyResult.success, true, "Expected repaired login apply to succeed");
    assert.strictEqual(
      Number(session.stationid),
      candidate.stationID,
      "Expected repaired login session to be docked",
    );
    assert.strictEqual(
      session.solarsystemid,
      null,
      "Expected repaired docked login to avoid space session activation",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      repairedStationID: repairedRecord.stationID,
      repairedSolarSystemID: repairedRecord.solarSystemID,
      sessionStationID: session.stationid,
      sessionSolarSystemID: session.solarsystemid,
    }, null, 2));
  } finally {
    writeRecord("characters", `/${candidate.characterID}`, originalCharacter);
    writeRecord("items", `/${candidate.ship.itemID}`, originalShip);
  }
}

main();
