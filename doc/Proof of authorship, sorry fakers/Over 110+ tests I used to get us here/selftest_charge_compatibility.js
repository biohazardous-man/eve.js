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

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 9750,
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
    sendNotification() {},
  };
}

function main() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const moduleType = resolveItemByName("Vizan's Modified Dual Heavy Pulse Laser");
  const validChargeType = resolveItemByName("Sanshas Microwave L");
  const invalidChargeType = resolveItemByName("Gleam L");
  assert(moduleType && moduleType.success, "Expected officer pulse laser type to exist");
  assert(validChargeType && validChargeType.success, "Expected Sanshas Microwave L to exist");
  assert(invalidChargeType && invalidChargeType.success, "Expected Gleam L to exist");

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
      if (!freeHighFlag) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        activeShip,
        stationID,
        freeHighFlag,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with a free high slot");
  const candidate = candidates[0];

  const dogma = new DogmaService();
  const session = buildDockedSession(candidate);
  const tempBaseID = getNextTemporaryItemID();
  const moduleItemID = tempBaseID;
  const invalidChargeItemID = tempBaseID + 1;
  const validChargeItemID = tempBaseID + 2;
  const tempItemIDs = new Set([moduleItemID, invalidChargeItemID, validChargeItemID]);

  try {
    writeTemporaryItem(
      moduleItemID,
      buildInventoryItem({
        itemID: moduleItemID,
        typeID: moduleType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.activeShip.itemID,
        flagID: candidate.freeHighFlag,
        itemName: moduleType.match.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      invalidChargeItemID,
      buildInventoryItem({
        itemID: invalidChargeItemID,
        typeID: invalidChargeType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.activeShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: invalidChargeType.match.name,
        quantity: 1,
        stacksize: 1,
        singleton: 0,
      }),
    );
    writeTemporaryItem(
      validChargeItemID,
      buildInventoryItem({
        itemID: validChargeItemID,
        typeID: validChargeType.match.typeID,
        ownerID: candidate.characterID,
        locationID: candidate.activeShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: validChargeType.match.name,
        quantity: 1,
        stacksize: 1,
        singleton: 0,
      }),
    );

    dogma.Handle_LoadAmmo(
      [
        candidate.activeShip.itemID,
        moduleItemID,
        { type: "list", items: [invalidChargeItemID] },
        candidate.activeShip.itemID,
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
      "Expected incompatible Gleam L to be rejected for the pulse laser",
    );
    assert(findItemById(invalidChargeItemID), "Expected incompatible Gleam L stack to remain in cargo");

    dogma.Handle_LoadAmmo(
      [
        candidate.activeShip.itemID,
        moduleItemID,
        { type: "list", items: [validChargeItemID] },
        candidate.activeShip.itemID,
      ],
      session,
    );

    const loadedValidCharge = getLoadedChargeByFlag(
      candidate.characterID,
      candidate.activeShip.itemID,
      candidate.freeHighFlag,
    );
    assert(loadedValidCharge, "Expected Sanshas Microwave L to load into the pulse laser");
    tempItemIDs.add(Number(loadedValidCharge.itemID) || 0);
    assert.strictEqual(
      Number(loadedValidCharge.typeID),
      Number(validChargeType.match.typeID),
      "Expected the loaded charge to be Sanshas Microwave L",
    );

    dogma.Handle_LoadAmmo(
      [
        candidate.activeShip.itemID,
        moduleItemID,
        { type: "list", items: [invalidChargeItemID] },
        candidate.activeShip.itemID,
      ],
      session,
    );

    const stillLoadedCharge = getLoadedChargeByFlag(
      candidate.characterID,
      candidate.activeShip.itemID,
      candidate.freeHighFlag,
    );
    assert(stillLoadedCharge, "Expected valid charge to remain loaded after incompatible swap attempt");
    assert.strictEqual(
      Number(stillLoadedCharge.typeID),
      Number(validChargeType.match.typeID),
      "Expected incompatible Gleam L swap attempt to leave Sanshas Microwave L loaded",
    );
    assert(findItemById(invalidChargeItemID), "Expected incompatible Gleam L stack to remain in cargo after swap attempt");

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      moduleItemID,
      freeHighFlag: candidate.freeHighFlag,
      loadedChargeTypeID: stillLoadedCharge.typeID,
      cargoStacks: listContainerItems(
        candidate.characterID,
        candidate.activeShip.itemID,
        ITEM_FLAGS.CARGO_HOLD,
      ).filter((item) => (
        Number(item.typeID) === Number(validChargeType.match.typeID) ||
        Number(item.typeID) === Number(invalidChargeType.match.typeID)
      )),
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
