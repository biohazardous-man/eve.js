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
const transitions = require(path.join(
  __dirname,
  "../../server/src/space/transitions",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
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

function writeCharacterRecord(characterID, record) {
  const result = database.write("characters", `/${characterID}`, record);
  assert(result.success, `Failed to restore character ${characterID}`);
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
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(characterRecord && (
        characterRecord.stationID || characterRecord.stationid || 0
      ));
      if (
        !characterRecord ||
        !ship ||
        stationID <= 0 ||
        Number(ship.locationID) !== stationID ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR
      ) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with an active ship");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9950,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.warFactionID) || 0,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    solarsystemid: null,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    shipName: candidate.ship.itemName,
    socket: { destroyed: false },
    notifications: [],
    sessionChanges: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChanges.push(change);
    },
  };
}

function main() {
  runtime._testing.clearScenes();
  const candidate = getCandidate();
  const previousCharacterRecord = clone(candidate.characterRecord);
  const previousShipRecord = clone(candidate.ship);
  const damagedShip = clone(candidate.ship);
  damagedShip.conditionState = {
    ...(damagedShip.conditionState || {}),
    damage: 0.19,
    charge: 0.42,
    armorDamage: 0.26,
    shieldCharge: 0.37,
    incapacitated: true,
  };
  writeItemRecord(candidate.ship.itemID, damagedShip);

  const session = buildSession({
    ...candidate,
    ship: damagedShip,
  });

  try {
    const undockResult = transitions.undockSession(session);
    assert.strictEqual(undockResult.success, true, "Expected undock to succeed");

    const updatedShipResult = database.read("items", `/${candidate.ship.itemID}`);
    assert(updatedShipResult.success, "Expected updated ship record after undock");
    const conditionState = updatedShipResult.data.conditionState || {};

    assert.strictEqual(Number(conditionState.charge), 1, "Expected undock capacitor to be full");
    assert.strictEqual(Number(conditionState.shieldCharge), 1, "Expected undock shields to be full");
    assert.strictEqual(Number(conditionState.armorDamage), 0, "Expected undock armor damage to reset");
    assert.strictEqual(Number(conditionState.damage), 0, "Expected undock hull damage to reset");
    assert.strictEqual(Boolean(conditionState.incapacitated), false, "Expected undock incapacitation to clear");

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      conditionState,
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    writeCharacterRecord(candidate.characterID, previousCharacterRecord);
    writeItemRecord(candidate.ship.itemID, previousShipRecord);
  }
}

main();
