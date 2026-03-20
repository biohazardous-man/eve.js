const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const InvBrokerService = require(path.join(
  __dirname,
  "../../server/src/services/inventory/invBrokerService",
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
  buildInventoryItem,
  findItemById,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  getShipSlotCounts,
  getSlotFlagsForFamily,
  listFittedItems,
  validateFitForShip,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function getDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getDictValue(value, key) {
  const entry = getDictEntries(value).find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function getRowLine(row) {
  if (!row || row.name !== "util.Row" || !row.args) {
    return [];
  }
  return getDictValue(row.args, "line") || [];
}

function getInvItemLine(infoEntry) {
  if (!infoEntry || !infoEntry.args) {
    return [];
  }
  return getRowLine(getDictValue(infoEntry.args, "invItem"));
}

function getNextTemporaryItemID() {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items table");
  let maxItemID = 0;
  for (const itemID of Object.keys(itemsResult.data || {})) {
    const numericItemID = Number(itemID) || 0;
    if (numericItemID > maxItemID) {
      maxItemID = numericItemID;
    }
  }
  return maxItemID + 5000;
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function getDockedCandidates() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = [];
  for (const characterID of Object.keys(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    if (numericCharacterID <= 0) {
      continue;
    }

    const characterRecord = getCharacterRecord(numericCharacterID);
    const activeShip = getActiveShipRecord(numericCharacterID);
    if (!characterRecord || !activeShip) {
      continue;
    }

    const stationID = Number(
      characterRecord.stationID || characterRecord.stationid || 0,
    );
    if (
      stationID <= 0 ||
      Number(activeShip.locationID) !== stationID ||
      Number(activeShip.flagID) !== ITEM_FLAGS.HANGAR
    ) {
      continue;
    }

    candidates.push({
      characterID: numericCharacterID,
      characterRecord,
      activeShip,
      stationID,
      slots: getShipSlotCounts(activeShip.typeID || activeShip.shipTypeID),
    });
  }

  return candidates;
}

function chooseFitCandidate(candidates) {
  const moduleChoices = [
    ["low", "Overdrive Injector System I"],
    ["low", "Reactor Control Unit I"],
    ["med", "Cap Recharger I"],
    ["med", "Warp Scrambler I"],
    ["high", "125mm Railgun I"],
    ["high", "Civilian Gatling Pulse Laser"],
  ];

  for (const candidate of candidates) {
    const shipID = candidate.activeShip.itemID;
    const charID = candidate.characterID;
    const fittedItems = listFittedItems(charID, shipID);

    for (const [family, itemName] of moduleChoices) {
      if ((candidate.slots[family] || 0) <= 0) {
        continue;
      }

      const moduleType = resolveExactItem(itemName);
      const freeFlag = getSlotFlagsForFamily(family).find(
        (flagID) =>
          !fittedItems.some((item) => Number(item.flagID) === Number(flagID)),
      );
      if (!freeFlag) {
        continue;
      }

      const probeItem = {
        itemID: -1,
        typeID: moduleType.typeID,
        groupID: moduleType.groupID,
        categoryID: moduleType.categoryID,
        flagID: ITEM_FLAGS.HANGAR,
        locationID: candidate.stationID,
        ownerID: charID,
        singleton: 0,
        stacksize: 1,
        quantity: 1,
      };
      const validation = validateFitForShip(
        charID,
        candidate.activeShip,
        probeItem,
        freeFlag,
        fittedItems,
      );
      if (!validation.success) {
        continue;
      }

      return {
        ...candidate,
        moduleType,
      };
    }
  }

  return null;
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 12000,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.activeShip.itemID,
    shipid: candidate.activeShip.itemID,
    activeShipID: candidate.activeShip.itemID,
    shipTypeID: candidate.activeShip.typeID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.factionID) || 0,
    sendNotification() {},
  };
}

function bindShipInventory(invBroker, session, shipID) {
  const bound = invBroker.Handle_GetInventoryFromId([shipID], session, {});
  const boundObjectID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert(boundObjectID, "Expected ship inventory bind to return a bound object ID");
  session.currentBoundObjectID = boundObjectID;
}

function writeTemporaryItem(itemID, item) {
  const result = database.write("items", `/${itemID}`, item);
  assert(result.success, `Failed to write temporary item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  const readResult = database.read("items", `/${itemID}`);
  if (readResult.success) {
    database.remove("items", `/${itemID}`);
  }
}

function main() {
  const candidate = chooseFitCandidate(getDockedCandidates());
  assert(candidate, "Expected a docked ship with a fit-compatible slot");

  const shipID = candidate.activeShip.itemID;
  const charID = candidate.characterID;
  const session = buildDockedSession(candidate);
  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const moduleItemID = getNextTemporaryItemID();

  writeTemporaryItem(
    moduleItemID,
    buildInventoryItem({
      itemID: moduleItemID,
      typeID: candidate.moduleType.typeID,
      ownerID: charID,
      locationID: candidate.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      stacksize: 1,
      singleton: 0,
      quantity: 1,
      itemName: `${candidate.moduleType.typeName} Prime Test`,
    }),
  );

  try {
    bindShipInventory(invBroker, session, shipID);
    const fitResult = invBroker.Handle_Add(
      [moduleItemID, candidate.stationID],
      session,
      { flag: 0 },
    );
    assert.strictEqual(fitResult, null, "Expected fitted add to return null");

    const fittedItem = listFittedItems(charID, shipID).find(
      (item) => Number(item.typeID) === Number(candidate.moduleType.typeID),
    );
    assert(fittedItem, "Expected the temporary module to be fitted");

    const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
    const shipInfo = getDictValue(allInfo.args, "shipInfo");
    const shipInfoEntries = getDictEntries(shipInfo);
    const shipRowEntry = shipInfoEntries.find(
      ([itemID]) => Number(itemID) === Number(shipID),
    );
    const fittedRowEntry = shipInfoEntries.find(
      ([itemID]) => Number(itemID) === Number(fittedItem.itemID),
    );

    assert(shipRowEntry, "Expected shipInfo to include the active ship row");
    assert(
      fittedRowEntry,
      "Expected shipInfo to include fitted module inventory rows for dogma prime",
    );

    const fittedLine = getInvItemLine(fittedRowEntry[1]);
    assert.strictEqual(
      Number(fittedLine[0]) || 0,
      Number(fittedItem.itemID),
      "Expected fitted row to use the fitted module item ID",
    );
    assert.strictEqual(
      Number(fittedLine[3]) || 0,
      Number(shipID),
      "Expected fitted row locationID to point at the active ship",
    );
    assert.strictEqual(
      Number(fittedLine[4]) || 0,
      Number(fittedItem.flagID),
      "Expected fitted row flagID to match the fitted slot",
    );

    const persistedModule = findItemById(fittedItem.itemID);
    assert(
      persistedModule && Number(persistedModule.locationID) === Number(shipID),
      "Expected the fitted module to persist under the ship location",
    );

    console.log(
      `selftest_dogma_getallinfo_ship_modules: ok (char=${charID}, ship=${shipID}, module=${fittedItem.itemID})`,
    );
  } finally {
    removeItemIfPresent(moduleItemID);
  }
}

main();
