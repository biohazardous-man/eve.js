/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

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
const {
  getFittedModuleItems,
  getLoadedChargeItems,
  isModuleOnline,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
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

function buildSession(candidate) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: candidate.characterID + 8100,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.warFactionID) || 0,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    stationid2: candidate.stationID,
    locationid: candidate.stationID,
    solarsystemid: null,
    solarsystemid2: candidate.solarSystemID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    shipName: candidate.ship.itemName,
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

function extractItemID(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload
    : [];
  const row = payload[0];
  if (!row || row.type !== "packedrow" || !row.fields) {
    return null;
  }
  return Number(row.fields.itemID) || null;
}

function extractGodmaShipEffectItemID(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload
    : [];
  return Number(payload[0]) || null;
}

function main() {
  runtime._testing.clearScenes();

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

      const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
      if (
        stationID <= 0 ||
        Number(ship.locationID) !== stationID ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR
      ) {
        return null;
      }

      const fittedModules = getFittedModuleItems(characterID, ship.itemID);
      const onlineModules = fittedModules
        .filter((item) => isModuleOnline(item));
      if (onlineModules.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
        solarSystemID: Number(characterRecord.solarSystemID || characterRecord.solarsystemid || 30000142),
        fittedModules,
        onlineModules,
        loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with online fitted modules");
  const candidate = candidates[0];
  const session = buildSession(candidate);
  const previousCharacterRecord = clone(candidate.characterRecord);
  const previousShipRecord = clone(candidate.ship);

  try {
    const result = transitions.undockSession(session);
    assert.strictEqual(result.success, true, "Expected undock to succeed");

    const itemChangeNotifications = session.notifications.filter(
      (notification) => notification.name === "OnItemChange",
    );
    const godmaEffectNotifications = session.notifications.filter(
      (notification) => notification.name === "OnGodmaShipEffect",
    );
    const refreshedItemIDs = new Set(
      itemChangeNotifications
        .map(extractItemID)
        .filter((itemID) => itemID > 0),
    );
    const godmaEffectItemIDs = new Set(
      godmaEffectNotifications
        .map(extractGodmaShipEffectItemID)
        .filter((itemID) => itemID > 0),
    );

    for (const moduleItem of candidate.fittedModules) {
      assert(
        refreshedItemIDs.has(moduleItem.itemID),
        `Expected undock to refresh fitted module ${moduleItem.itemID}`,
      );
    }

    for (const chargeItem of candidate.loadedCharges) {
      assert(
        refreshedItemIDs.has(chargeItem.itemID),
        `Expected undock to refresh loaded charge ${chargeItem.itemID}`,
      );
    }

    for (const moduleItem of candidate.onlineModules) {
      assert(
        godmaEffectItemIDs.has(moduleItem.itemID),
        `Expected undock to replay online effect for module ${moduleItem.itemID}`,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      fittedModuleIDs: candidate.fittedModules.map((item) => item.itemID),
      onlineModuleIDs: candidate.onlineModules.map((item) => item.itemID),
      loadedChargeIDs: candidate.loadedCharges.map((item) => item.itemID),
      refreshedItemIDs: Array.from(refreshedItemIDs).sort((left, right) => left - right),
      godmaEffectItemIDs: Array.from(godmaEffectItemIDs).sort((left, right) => left - right),
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    writeCharacterRecord(candidate.characterID, previousCharacterRecord);
    writeItemRecord(candidate.ship.itemID, previousShipRecord);
  }
}

main();
