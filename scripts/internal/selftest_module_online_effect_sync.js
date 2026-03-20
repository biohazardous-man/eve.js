const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const DogmaService = require(path.join(
  __dirname,
  "../../server/src/services/dogma/dogmaService",
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
  findItemById,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  getFittedModuleItems,
  isModuleOnline,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeItemRecord(itemID, record) {
  const result = database.write("items", `/${itemID}`, record);
  assert(result.success, `Failed to restore item ${itemID}`);
}

function buildSession(candidate) {
  const notifications = [];
  return {
    clientID: candidate.characterID + 8700,
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
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function extractEffectSummary(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload
    : [];
  return {
    itemID: Number(payload[0]) || 0,
    effectID: Number(payload[1]) || 0,
    start: Number(payload[3]) || 0,
    active: Number(payload[4]) || 0,
  };
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

      const onlineModule = getFittedModuleItems(characterID, ship.itemID)
        .find((item) => isModuleOnline(item));
      if (!onlineModule) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
        moduleItem: onlineModule,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with an online fitted module");
  const candidate = candidates[0];
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const previousModuleRecord = clone(candidate.moduleItem);

  try {
    dogma.Handle_TakeModuleOffline([candidate.ship.itemID, candidate.moduleItem.itemID], session);
    let currentModule = findItemById(candidate.moduleItem.itemID);
    assert(currentModule, "Expected module to still exist after offlining");
    assert.strictEqual(isModuleOnline(currentModule), false, "Expected module to be offline");

    dogma.Handle_SetModuleOnline([candidate.ship.itemID, candidate.moduleItem.itemID], session);
    currentModule = findItemById(candidate.moduleItem.itemID);
    assert(currentModule, "Expected module to still exist after onlining");
    assert.strictEqual(isModuleOnline(currentModule), true, "Expected module to be online again");

    const godmaEffects = session.notifications
      .filter((notification) => notification.name === "OnGodmaShipEffect")
      .map(extractEffectSummary)
      .filter((entry) => entry.itemID === candidate.moduleItem.itemID);

    assert(
      godmaEffects.some((entry) => entry.active === 0),
      "Expected offlining to emit an inactive online-effect notification",
    );
    assert(
      godmaEffects.some((entry) => entry.active === 1),
      "Expected onlining to emit an active online-effect notification",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      moduleID: candidate.moduleItem.itemID,
      godmaEffects,
    }, null, 2));
  } finally {
    writeItemRecord(candidate.moduleItem.itemID, previousModuleRecord);
  }
}

main();
