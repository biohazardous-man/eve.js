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
  getSlotFlagsForFamily,
  listFittedItems,
  validateFitForShip,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function getInventoryEntries(value) {
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items.map((item) =>
      item && item.type === "packedrow" && item.fields ? item.fields : item);
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "rowset" && Array.isArray(value.lines)) {
    return value.lines;
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
  return maxItemID + 2000;
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
        family,
        freeFlag,
        moduleType,
      };
    }
  }

  return null;
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 10000,
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
  const tempItemIDs = [];

  try {
    const freeFlag = Number(candidate.freeFlag) || 0;
    assert(freeFlag > 0, "Expected a free fitting slot on the candidate ship");

    const moduleItemID = getNextTemporaryItemID();
    const cargoItemID = moduleItemID + 1;
    tempItemIDs.push(moduleItemID, cargoItemID);

    writeTemporaryItem(
      moduleItemID,
      buildInventoryItem({
        itemID: moduleItemID,
        typeID: candidate.moduleType.typeID,
        ownerID: charID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: candidate.moduleType.name,
        quantity: 1,
        stacksize: 1,
        singleton: 0,
      }),
    );

    writeTemporaryItem(
      cargoItemID,
      buildInventoryItem({
        itemID: cargoItemID,
        typeID: resolveExactItem("Tritanium").typeID,
        ownerID: charID,
        locationID: shipID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: "Tritanium",
        quantity: 100,
        stacksize: 100,
        singleton: 0,
      }),
    );

    bindShipInventory(invBroker, session, shipID);
    invBroker.Handle_Add([moduleItemID, candidate.stationID], session, {
      flag: freeFlag,
    });

    const fittedModule = findItemById(moduleItemID);
    assert(fittedModule, "Expected fitted module to exist");
    assert.strictEqual(Number(fittedModule.locationID), Number(shipID));
    assert.strictEqual(Number(fittedModule.flagID), Number(freeFlag));

    const defaultList = invBroker.Handle_List([], session, {});
    const defaultLines = getInventoryEntries(defaultList);
    assert.strictEqual(defaultList.type, "list");
    assert(
      defaultLines.some((line) => Number(line.itemID ?? line[0]) === Number(moduleItemID)),
      "Expected plain ship-inventory List() to include fitted modules",
    );
    assert(
      defaultLines.some((line) => Number(line.itemID ?? line[0]) === Number(cargoItemID)),
      "Expected plain ship-inventory List() to include cargo items",
    );

    const cargoOnlyList = invBroker.Handle_List([ITEM_FLAGS.CARGO_HOLD], session, {});
    const cargoLines = getInventoryEntries(cargoOnlyList);
    assert(
      cargoLines.some((line) => Number(line.itemID ?? line[0]) === Number(cargoItemID)),
      "Expected explicit cargo List() to include cargo items",
    );
    assert(
      !cargoLines.some((line) => Number(line.itemID ?? line[0]) === Number(moduleItemID)),
      "Expected explicit cargo List() to exclude fitted modules",
    );
  } finally {
    for (const itemID of tempItemIDs) {
      removeItemIfPresent(itemID);
    }
  }

  console.log("selftest_ship_inventory_default_list: ok");
}

main();
