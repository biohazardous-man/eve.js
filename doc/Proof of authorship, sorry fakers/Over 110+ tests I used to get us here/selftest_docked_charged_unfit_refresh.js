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
  listContainerItems,
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
  getFittedModuleItems,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function getNextTemporaryItemID() {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items table");
  let maxItemID = 0;
  for (const itemID of Object.keys(itemsResult.data || {})) {
    maxItemID = Math.max(maxItemID, Number(itemID) || 0);
  }
  return maxItemID + 17000;
}

function writeTemporaryItem(itemID, item) {
  const result = database.write("items", `/${itemID}`, item);
  assert(result.success, `Failed to write temporary item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  if (database.read("items", `/${itemID}`).success) {
    database.remove("items", `/${itemID}`);
  }
}

function buildDockedSession(candidate, notifications) {
  return {
    clientID: candidate.characterID + 9600,
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
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function bindInventory(invBroker, session, inventoryID) {
  const bound = invBroker.Handle_GetInventoryFromId([inventoryID], session, {});
  const boundObjectID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert(boundObjectID, `Expected inventory bind for ${inventoryID} to return a bound object ID`);
  session.currentBoundObjectID = boundObjectID;
}

function parseItemChange(notification) {
  if (
    !notification ||
    notification.name !== "OnItemChange" ||
    !Array.isArray(notification.payload)
  ) {
    return null;
  }

  const row = notification.payload[0];
  if (!row || row.type !== "packedrow" || !row.fields) {
    return null;
  }

  return {
    itemID: Number(row.fields.itemID) || 0,
    locationID: Number(row.fields.locationID) || 0,
    flagID: Number(row.fields.flagID) || 0,
    typeID: Number(row.fields.typeID) || 0,
    stacksize: Number(row.fields.stacksize) || 0,
  };
}

function main() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");

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

      const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
      if (
        stationID <= 0 ||
        Number(activeShip.locationID) !== stationID ||
        Number(activeShip.flagID) !== ITEM_FLAGS.HANGAR
      ) {
        return null;
      }

      const existingFittedModules = getFittedModuleItems(characterID, activeShip.itemID);

      const slots = getShipSlotCounts(activeShip.typeID || activeShip.shipTypeID);
      if ((slots.high || 0) <= 0) {
        return null;
      }

      const occupiedFlags = new Set(
        listFittedItems(characterID, activeShip.itemID).map(
          (item) => Number(item.flagID) || 0,
        ),
      );
      const freeHighFlag = getSlotFlagsForFamily("high", activeShip.typeID)
        .find((flagID) => !occupiedFlags.has(flagID));
      if (!freeHighFlag) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        activeShip,
        stationID,
        freeHighFlag,
        existingFittedModules,
        chargeCapacity: getModuleChargeCapacity(
          weaponType.match.typeID,
          chargeType.match.typeID,
        ),
      };
    })
    .filter(Boolean);

  assert(
    candidates.length > 0,
    "Expected a docked character with a free high slot",
  );
  const candidate = candidates[0];

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const notifications = [];
  const session = buildDockedSession(candidate, notifications);

  const tempBaseID = getNextTemporaryItemID();
  const launcherItemID = tempBaseID;
  const hangarChargeStackID = tempBaseID + 1;
  const tempItemIDs = new Set([launcherItemID, hangarChargeStackID]);

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
      hangarChargeStackID,
      buildInventoryItem({
        itemID: hangarChargeStackID,
        typeID: chargeType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: chargeType.match.name,
        quantity: candidate.chargeCapacity + 9,
        stacksize: candidate.chargeCapacity + 9,
        singleton: 0,
      }),
    );

    bindInventory(invBroker, session, candidate.activeShip.itemID);
    invBroker.Handle_Add(
      [launcherItemID, candidate.stationID],
      session,
      { flag: candidate.freeHighFlag },
    );

    notifications.length = 0;
    dogma.Handle_LoadAmmo(
      [
        candidate.activeShip.itemID,
        launcherItemID,
        { type: "list", items: [hangarChargeStackID] },
        candidate.stationID,
      ],
      session,
    );

    const loadedCharge = getLoadedChargeByFlag(
      candidate.characterID,
      candidate.activeShip.itemID,
      candidate.freeHighFlag,
    );
    assert(loadedCharge, "Expected temporary launcher to be loaded before unfit");
    tempItemIDs.add(Number(loadedCharge.itemID) || 0);

    notifications.length = 0;
    dogma.Handle_UnloadAmmo(
      [
        candidate.activeShip.itemID,
        launcherItemID,
        [candidate.stationID, candidate.characterID, ITEM_FLAGS.HANGAR],
      ],
      session,
    );

    bindInventory(invBroker, session, candidate.stationID);
    invBroker.Handle_Add(
      [launcherItemID, candidate.activeShip.itemID],
      session,
      { flag: ITEM_FLAGS.HANGAR },
    );

    const fittedModule = findItemById(launcherItemID);
    assert(fittedModule, "Expected temporary launcher item to still exist after unfit");
    assert.strictEqual(
      Number(fittedModule.locationID),
      Number(candidate.stationID),
      "Expected temporary launcher to move back into the station hangar",
    );
    assert.strictEqual(
      Number(fittedModule.flagID),
      Number(ITEM_FLAGS.HANGAR),
      "Expected temporary launcher to end up in the hangar flag after unfit",
    );
    assert.strictEqual(
      getLoadedChargeByFlag(
        candidate.characterID,
        candidate.activeShip.itemID,
        candidate.freeHighFlag,
      ),
      null,
      "Expected temporary launcher slot to be empty after unload + unfit",
    );

    const parsedItemChanges = notifications
      .filter((entry) => entry && entry.name === "OnItemChange")
      .map(parseItemChange)
      .filter(Boolean);
    const changedItemIDs = new Set(parsedItemChanges.map((entry) => entry.itemID));

    assert(
      changedItemIDs.has(launcherItemID),
      "Expected charged-module unfit flow to send an OnItemChange for the module itself",
    );
    assert(
      changedItemIDs.has(Number(loadedCharge.itemID) || 0) ||
      changedItemIDs.has(hangarChargeStackID),
      "Expected charged-module unfit flow to refresh the unloaded ammo stack live",
    );
    const launcherRefreshCount = parsedItemChanges.filter(
      (entry) => entry.itemID === launcherItemID,
    ).length;
    assert(
      launcherRefreshCount >= 2,
      "Expected docked charged-module unfit flow to replay the fitting state so the temporary launcher refreshes more than once",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      launcherItemID,
      loadedChargeItemID: loadedCharge.itemID,
      refreshedItemIDs: Array.from(changedItemIDs).sort((left, right) => left - right),
      launcherRefreshCount,
      hangarAmmoStacks: listContainerItems(
        candidate.characterID,
        candidate.stationID,
        ITEM_FLAGS.HANGAR,
      )
        .filter((item) => Number(item.typeID) === Number(chargeType.match.typeID))
        .map((item) => ({ itemID: item.itemID, stacksize: item.stacksize })),
    }, null, 2));
  } finally {
    for (const itemID of tempItemIDs) {
      if (itemID > 0) {
        removeItemIfPresent(itemID);
      }
    }
  }
}

main();
