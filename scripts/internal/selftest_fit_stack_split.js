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
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
  isShipFittingFlag,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function getInventoryEntries(value) {
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items.map((item) =>
      item && item.type === "packedrow" && item.fields ? item.fields : item);
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value &&
    value.name === "eve.common.script.sys.rowset.Rowset" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    const linesEntry = value.args.entries.find(([key]) => key === "lines");
    if (linesEntry && linesEntry[1] && Array.isArray(linesEntry[1].items)) {
      return linesEntry[1].items;
    }
  }
  return [];
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
  return maxItemID + 4000;
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

function chooseCandidate(candidates) {
  const moduleChoices = [
    ["low", "Overdrive Injector System I"],
    ["low", "Reactor Control Unit I"],
    ["low", "Power Diagnostic System I"],
    ["med", "1MN Monopropellant Enduring Afterburner"],
    ["med", "Cap Recharger I"],
    ["med", "Warp Scrambler I"],
    ["high", "125mm Railgun I"],
    ["high", "Civilian Gatling Pulse Laser"],
    ["high", "Civilian Gatling Autocannon"],
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
      const freeFlag = selectAutoFitFlagForType(
        candidate.activeShip,
        fittedItems,
        moduleType.typeID,
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
        stacksize: 50,
        quantity: 50,
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
        freeFlag,
        moduleType,
      };
    }
  }

  return null;
}

function buildDockedSession(candidate) {
  const notifications = [];
  return {
    session: {
      clientID: candidate.characterID + 11000,
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
      sendNotification(name, narrowcast, payload) {
        notifications.push({ name, narrowcast, payload });
      },
    },
    notifications,
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
  const candidate = chooseCandidate(getDockedCandidates());
  assert(candidate, "Expected a docked candidate ship with a free fit slot");

  const invBroker = new InvBrokerService();
  const { session, notifications } = buildDockedSession(candidate);
  const sourceStackID = getNextTemporaryItemID();
  let fittedItemID = null;

  try {
    writeTemporaryItem(
      sourceStackID,
      buildInventoryItem({
        itemID: sourceStackID,
        typeID: candidate.moduleType.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: candidate.moduleType.name,
        singleton: 0,
        quantity: 50,
        stacksize: 50,
      }),
    );

    bindShipInventory(invBroker, session, candidate.activeShip.itemID);

    fittedItemID = invBroker.Handle_Add(
      [sourceStackID, candidate.stationID],
      session,
      { flag: 0 },
    );

    assert(
      Number.isFinite(Number(fittedItemID)) && Number(fittedItemID) > 0,
      "Expected fitting a stack to return the new fitted item ID",
    );
    assert.notStrictEqual(
      Number(fittedItemID),
      Number(sourceStackID),
      "Expected fitting from a stack to split into a new fitted item",
    );

    const sourceStack = findItemById(sourceStackID);
    assert(sourceStack, "Expected original source stack to remain after fitting one item");
    assert.strictEqual(Number(sourceStack.locationID), Number(candidate.stationID));
    assert.strictEqual(Number(sourceStack.flagID), Number(ITEM_FLAGS.HANGAR));
    assert.strictEqual(Number(sourceStack.singleton), 0);
    assert.strictEqual(Number(sourceStack.stacksize), 49);
    assert.strictEqual(Number(sourceStack.quantity), 49);

    const fittedItem = findItemById(fittedItemID);
    assert(fittedItem, "Expected split fitted module item to exist");
    assert.strictEqual(Number(fittedItem.locationID), Number(candidate.activeShip.itemID));
    assert(
      isShipFittingFlag(Number(fittedItem.flagID)),
      "Expected fitted split item to land in a live fitting flag",
    );
    assert.strictEqual(Number(fittedItem.singleton), 1);
    assert.strictEqual(Number(fittedItem.stacksize), 1);
    assert.strictEqual(Number(fittedItem.quantity), -1);

    const defaultList = invBroker.Handle_List([], session, {});
    const lines = getInventoryEntries(defaultList);
    assert(
      lines.some((line) => Number(line.itemID ?? line[0]) === Number(fittedItemID)),
      "Expected ship inventory List() to expose the newly fitted split item",
    );

    assert(
      notifications.some((entry) => entry.name === "OnItemChange"),
      "Expected fitting from stack to notify the client of inventory changes",
    );
  } finally {
    if (fittedItemID) {
      removeItemIfPresent(fittedItemID);
    }
    removeItemIfPresent(sourceStackID);
  }

  console.log("selftest_fit_stack_split: ok");
}

main();
