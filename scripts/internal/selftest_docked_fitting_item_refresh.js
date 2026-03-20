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
const {
  getFittedModuleItems,
  getLoadedChargeItems,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function buildLoginStyleSession(candidate) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: candidate.characterID + 8400,
    userid: candidate.characterID,
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

function main() {
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
      if (fittedModules.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
        fittedModules,
        loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with fitted modules");
  const candidate = candidates[0];
  const session = buildLoginStyleSession(candidate);

  const result = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: true,
    logSelection: false,
  });
  assert.strictEqual(result.success, true, "Expected docked login session apply to succeed");

  const itemChangeNotifications = session.notifications.filter(
    (notification) => notification.name === "OnItemChange",
  );
  const refreshedItemIDs = new Set(
    itemChangeNotifications
      .map(extractItemID)
      .filter((itemID) => itemID > 0),
  );

  for (const moduleItem of candidate.fittedModules) {
    assert(
      refreshedItemIDs.has(moduleItem.itemID),
      `Expected docked apply to refresh fitted module ${moduleItem.itemID}`,
    );
  }

  for (const chargeItem of candidate.loadedCharges) {
    assert(
      refreshedItemIDs.has(chargeItem.itemID),
      `Expected docked apply to refresh loaded charge ${chargeItem.itemID}`,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    characterID: candidate.characterID,
    shipID: candidate.ship.itemID,
    fittedModuleIDs: candidate.fittedModules.map((item) => item.itemID),
    loadedChargeIDs: candidate.loadedCharges.map((item) => item.itemID),
    refreshedItemIDs: Array.from(refreshedItemIDs).sort((left, right) => left - right),
  }, null, 2));
}

main();
