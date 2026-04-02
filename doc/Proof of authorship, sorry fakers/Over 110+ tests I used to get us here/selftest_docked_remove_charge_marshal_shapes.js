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
  return maxItemID + 19000;
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

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 9700,
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
      if (!Number.isInteger(freeHighFlag)) {
        return null;
      }

      const chargeCapacity = getModuleChargeCapacity(
        weaponType.match.typeID,
        chargeType.match.typeID,
      );
      if (chargeCapacity <= 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        activeShip,
        stationID,
        freeHighFlag,
        chargeCapacity,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked candidate with a free high slot");
  const candidate = candidates[0];

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const session = buildDockedSession(candidate);

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
        quantity: candidate.chargeCapacity + 3,
        stacksize: candidate.chargeCapacity + 3,
        singleton: 0,
      }),
    );

    bindInventory(invBroker, session, candidate.activeShip.itemID);
    invBroker.Handle_Add(
      [launcherItemID, candidate.stationID],
      session,
      { flag: candidate.freeHighFlag },
    );

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
    assert(loadedCharge, "Expected launcher to be loaded before docked remove-charge test");
    tempItemIDs.add(Number(loadedCharge.itemID) || 0);

    dogma.Handle_UnloadAmmo(
      [
        candidate.activeShip.itemID,
        { type: "list", items: [launcherItemID] },
        { type: "tuple", items: [candidate.stationID, candidate.characterID, ITEM_FLAGS.HANGAR] },
      ],
      session,
    );

    assert.strictEqual(
      getLoadedChargeByFlag(
        candidate.characterID,
        candidate.activeShip.itemID,
        candidate.freeHighFlag,
      ),
      null,
      "Expected marshal-wrapped docked Remove Charge to clear the fitting charge slot",
    );

    const restoredHangarStack = findItemById(hangarChargeStackID);
    assert(restoredHangarStack, "Expected original hangar ammo stack to still exist after unload");
    assert.strictEqual(
      Number(restoredHangarStack.locationID),
      Number(candidate.stationID),
      "Expected unloaded charge to end up in the station hangar",
    );
    assert.strictEqual(
      Number(restoredHangarStack.flagID),
      Number(ITEM_FLAGS.HANGAR),
      "Expected unloaded charge to restore into the hangar flag",
    );
    assert.strictEqual(
      Number(restoredHangarStack.stacksize),
      Number(candidate.chargeCapacity + 3),
      "Expected docked Remove Charge to merge back into the original hangar stack",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      launcherItemID,
      loadedChargeItemID: loadedCharge.itemID,
      hangarChargeStackID,
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
