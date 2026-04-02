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
  getLoadedChargeByFlag,
  getModuleChargeCapacity,
  getShipSlotCounts,
  getSlotFlagsForFamily,
  listFittedItems,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

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
  return maxItemID + 6000;
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

function buildDockedSession(candidate, notifications) {
  return {
    clientID: candidate.characterID + 9800,
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

function extractPackedRow(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload
    : [];
  const row = payload[0];
  return row && row.type === "packedrow" ? row : null;
}

function extractChangeEntries(notification) {
  const payload = Array.isArray(notification && notification.payload)
    ? notification.payload
    : [];
  const changeDict = payload[1];
  return Array.isArray(changeDict && changeDict.entries)
    ? changeDict.entries
    : [];
}

function getPreviousValue(changeEntries, key) {
  const entry = changeEntries.find(([entryKey]) => Number(entryKey) === Number(key));
  return entry ? entry[1] : undefined;
}

function main() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const weaponType = resolveItemByName("Arbalest Compact Light Missile Launcher");
  const chargeType = resolveItemByName("Scourge Light Missile");
  assert(weaponType && weaponType.success, "Expected missile launcher type to exist");
  assert(chargeType && chargeType.success, "Expected missile charge type to exist");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const activeShip = getActiveShipRecord(characterID);
      if (!characterRecord || !activeShip) {
        return null;
      }

      const stationID = Number(
        characterRecord.stationID || characterRecord.stationid || 0,
      );
      if (
        stationID <= 0 ||
        Number(activeShip.locationID) !== stationID ||
        Number(activeShip.flagID) !== ITEM_FLAGS.HANGAR
      ) {
        return null;
      }

      const slots = getShipSlotCounts(activeShip.typeID || activeShip.shipTypeID);
      if ((slots.high || 0) <= 0) {
        return null;
      }

      const occupiedFlags = new Set(
        listFittedItems(characterID, activeShip.itemID).map(
          (item) => Number(item.flagID) || 0,
        ),
      );
      const highFlags = getSlotFlagsForFamily("high", activeShip.typeID);
      const freeHighFlag = highFlags.find((flagID) => !occupiedFlags.has(flagID));
      if (!Number.isInteger(freeHighFlag)) {
        return null;
      }

      const capacity = getModuleChargeCapacity(
        weaponType.match.typeID,
        chargeType.match.typeID,
      );
      if (capacity <= 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        activeShip,
        stationID,
        slots,
        chargeCapacity: capacity,
        freeHighFlag,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with at least one high slot");
  const candidate = candidates[0];

  const freeHighFlag = Number(candidate.freeHighFlag) || 0;
  assert(Number.isInteger(freeHighFlag) && freeHighFlag > 0, "Expected a free high slot");

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const notifications = [];
  const session = buildDockedSession(candidate, notifications);
  bindShipInventory(invBroker, session, candidate.activeShip.itemID);

  const tempBaseID = getNextTemporaryItemID();
  const launcherItemID = tempBaseID;
  const sourceChargeStackID = tempBaseID + 1;
  const tempItemIDs = new Set([launcherItemID, sourceChargeStackID]);
  let loadedChargeItemID = null;

  try {
    writeTemporaryItem(
      launcherItemID,
      buildInventoryItem({
        itemID: launcherItemID,
        typeID: weaponType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: weaponType.match.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      sourceChargeStackID,
      buildInventoryItem({
        itemID: sourceChargeStackID,
        typeID: chargeType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: chargeType.match.name,
        quantity: candidate.chargeCapacity + 37,
        stacksize: candidate.chargeCapacity + 37,
        singleton: 0,
      }),
    );

    invBroker.Handle_Add(
      [launcherItemID, candidate.stationID],
      session,
      { flag: freeHighFlag },
    );

    notifications.length = 0;

    dogma.Handle_LoadAmmo(
      [
        candidate.activeShip.itemID,
        [launcherItemID],
        [sourceChargeStackID],
        candidate.stationID,
      ],
      session,
    );

    const loadedCharge = getLoadedChargeByFlag(
      candidate.characterID,
      candidate.activeShip.itemID,
      freeHighFlag,
    );
    assert(loadedCharge, "Expected loaded charge to exist after docked LoadAmmo");
    loadedChargeItemID = Number(loadedCharge.itemID) || null;
    assert(loadedChargeItemID, "Expected loaded charge item to have a real itemID");
    assert.notStrictEqual(
      loadedChargeItemID,
      sourceChargeStackID,
      "Expected a partial hangar load to create a new fitted charge item",
    );
    tempItemIDs.add(loadedChargeItemID);

    const remainingHangarStack = findItemById(sourceChargeStackID);
    assert(remainingHangarStack, "Expected source hangar stack to remain after partial load");
    assert.strictEqual(
      Number(remainingHangarStack.stacksize),
      37,
      "Expected source hangar stack to retain only the leftover rounds",
    );
    assert.strictEqual(
      Number(loadedCharge.stacksize),
      Number(candidate.chargeCapacity),
      "Expected fitted charge stack to load exactly module capacity",
    );

    const itemChanges = notifications.filter(
      (entry) => entry.name === "OnItemChange",
    );
    const loadedChargeNotification = itemChanges.find((entry) => {
      const row = extractPackedRow(entry);
      return row && Number(row.fields && row.fields.itemID) === loadedChargeItemID;
    });
    assert(
      loadedChargeNotification,
      "Expected docked ammo load to emit OnItemChange for the new fitted charge stack",
    );

    const loadedChargeRow = extractPackedRow(loadedChargeNotification);
    assert.strictEqual(
      Number(loadedChargeRow.fields.locationID),
      Number(candidate.activeShip.itemID),
      "Expected fitted charge notification to point at the ship inventory location",
    );
    assert.strictEqual(
      Number(loadedChargeRow.fields.flagID),
      Number(freeHighFlag),
      "Expected fitted charge notification to point at the module flag",
    );

    const changeEntries = extractChangeEntries(loadedChargeNotification);
    assert.strictEqual(
      Number(getPreviousValue(changeEntries, 3)),
      0,
      "Expected the new fitted charge row to advertise creation from outside the inventory",
    );
    assert.strictEqual(
      Number(getPreviousValue(changeEntries, 5)),
      0,
      "Expected the new fitted charge row to advertise a zero previous quantity",
    );
    assert.strictEqual(
      Number(getPreviousValue(changeEntries, 9)),
      0,
      "Expected the new fitted charge row to advertise a zero previous stacksize",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      launcherItemID,
      sourceChargeStackID,
      loadedChargeItemID,
      launcherFlagID: freeHighFlag,
      chargeCapacity: candidate.chargeCapacity,
      leftoverRounds: Number(remainingHangarStack.stacksize),
    }, null, 2));
  } finally {
    for (const itemID of tempItemIDs) {
      removeItemIfPresent(itemID);
    }
  }
}

main();
