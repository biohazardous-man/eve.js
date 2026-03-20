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
const worldData = require(path.join(
  __dirname,
  "../../server/src/space/worldData",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  updateShipItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  persistCharacterLogoffState,
} = require(path.join(
  __dirname,
  "../../server/src/services/_shared/sessionDisconnect",
));

function buildSession(characterID, shipID, solarSystemID) {
  return {
    clientID: 950000000 + characterID,
    characterID,
    charid: characterID,
    characterName: `selftest-${characterID}`,
    corporationID: 1000006,
    allianceID: 0,
    warFactionID: 0,
    stationID: null,
    stationid: null,
    solarsystemid: solarSystemID,
    solarsystemid2: solarSystemID,
    shipID,
    shipid: shipID,
    _space: {
      systemID: solarSystemID,
      shipID,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidateEntry = Object.entries(charactersResult.data || {})
    .map(([characterID, record]) => [Number(characterID) || 0, record])
    .find(([characterID, record]) =>
      characterID > 0 &&
      record &&
      Number(record.shipID || 0) > 0 &&
      Number(record.stationID || 0) > 0,
    );
  assert(candidateEntry, "Expected a docked character to exist");

  const [characterID] = candidateEntry;
  const originalRecord = clone(getCharacterRecord(characterID));
  const originalShip = clone(database.read("items", `/${Number(originalRecord.shipID)}`).data);
  assert(originalRecord, "Expected original character record to exist");
  assert(originalShip, "Expected original active ship row to exist");

  const station = worldData.getStationByID(Number(originalRecord.stationID || 0));
  const spaceSystemID =
    Number((station && station.solarSystemID) || originalRecord.solarSystemID || 30000142) ||
    30000142;
  const shipID = Number(originalShip.itemID || 0);

  runtime._testing.clearScenes();

  try {
    const seededSpaceState = {
      systemID: spaceSystemID,
      position: { x: 150000, y: -250000, z: 375000 },
      velocity: { x: 12, y: 0, z: -3 },
      direction: { x: 0, y: 0, z: 1 },
      targetPoint: { x: 155000, y: -250000, z: 380000 },
      speedFraction: 0.35,
      mode: "GOTO",
      targetEntityID: null,
      followRange: 0,
      orbitDistance: 0,
      orbitNormal: { x: 0, y: 1, z: 0 },
      orbitSign: 1,
      pendingWarp: null,
      warpState: null,
    };

    const spaceShipResult = updateShipItem(shipID, (currentItem) => ({
      ...currentItem,
      locationID: spaceSystemID,
      flagID: 0,
      spaceState: seededSpaceState,
    }));
    assert(spaceShipResult.success, "Expected in-space ship preparation to succeed");

    const prepareCharResult = updateCharacterRecord(characterID, (record) => ({
      ...record,
      stationID: null,
      solarSystemID: spaceSystemID,
    }));
    assert(prepareCharResult.success, "Expected in-space character preparation to succeed");

    const liveSession = buildSession(characterID, shipID, spaceSystemID);
    const entity = runtime.attachSession(liveSession, spaceShipResult.data, {
      broadcast: false,
      skipLegacyStationNormalization: true,
    });
    assert(entity, "Expected runtime attach to create a live ship entity");

    entity.position = { x: 987654, y: -123456, z: 222333 };
    entity.velocity = { x: 55, y: -2, z: 11 };
    entity.direction = { x: 0.5, y: 0, z: 0.8660254038 };
    entity.targetPoint = { x: 990000, y: -120000, z: 225000 };
    entity.speedFraction = 0.78;
    entity.mode = "GOTO";
    entity.followRange = 2500;
    entity.orbitDistance = 0;
    entity.orbitNormal = { x: 0, y: 1, z: 0 };
    entity.orbitSign = 1;

    const livePersistResult = persistCharacterLogoffState(liveSession);
    assert(livePersistResult.success, "Expected live in-space disconnect persistence to succeed");

    const liveShipRow = database.read("items", `/${shipID}`).data;
    const liveCharacterRow = getCharacterRecord(characterID);
    assert.strictEqual(liveCharacterRow.stationID, null, "Expected live disconnect to remain in space");
    assert.strictEqual(
      Number(liveCharacterRow.solarSystemID),
      spaceSystemID,
      "Expected live disconnect to persist the active solar system",
    );
    assert.strictEqual(Number(liveShipRow.flagID || 0), 0, "Expected live disconnect to keep ship in space");
    assert.strictEqual(
      Number(liveShipRow.locationID),
      spaceSystemID,
      "Expected live disconnect to keep ship location in the active solar system",
    );
    assert.deepStrictEqual(
      liveShipRow.spaceState.position,
      entity.position,
      "Expected live disconnect persistence to capture the runtime entity position",
    );

    runtime.detachSession(liveSession, { broadcast: false });
    runtime._testing.clearScenes();

    const dockedShipRestore = updateShipItem(shipID, () => originalShip);
    assert(dockedShipRestore.success, "Expected docked ship restore to succeed");

    const mismatchCharResult = updateCharacterRecord(characterID, (record) => ({
      ...record,
      stationID: null,
      solarSystemID: spaceSystemID,
    }));
    assert(mismatchCharResult.success, "Expected mismatch character setup to succeed");

    const mismatchSession = buildSession(characterID, shipID, spaceSystemID);
    const mismatchPersistResult = persistCharacterLogoffState(mismatchSession);
    assert(
      mismatchPersistResult.success,
      "Expected mismatched in-space disconnect persistence to succeed",
    );

    const repairedCharacterRow = getCharacterRecord(characterID);
    const repairedShipRow = database.read("items", `/${shipID}`).data;
    assert.strictEqual(
      Number(repairedCharacterRow.stationID),
      Number(originalShip.locationID),
      "Expected missing live ship state to reconcile back to the docked station",
    );
    assert.strictEqual(
      Number(repairedCharacterRow.solarSystemID),
      spaceSystemID,
      "Expected docked reconciliation to use the station solar system",
    );
    assert.strictEqual(
      Number(repairedShipRow.flagID || 0),
      Number(originalShip.flagID || 0),
      "Expected missing live ship state to leave the docked ship row unchanged",
    );
    assert.strictEqual(
      repairedShipRow.spaceState,
      null,
      "Expected missing live ship state to avoid inventing a synthetic spaceState",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID,
      shipID,
      livePosition: liveShipRow.spaceState.position,
      repairedStationID: repairedCharacterRow.stationID,
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    const restoreResult = updateCharacterRecord(characterID, () => originalRecord);
    assert(restoreResult.success, "Expected original character record restoration to succeed");
    const restoreShipResult = updateShipItem(shipID, () => originalShip);
    assert(restoreShipResult.success, "Expected original ship row restoration to succeed");
  }
}

main();
