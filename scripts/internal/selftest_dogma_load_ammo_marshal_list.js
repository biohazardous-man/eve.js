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
const ShipService = require(path.join(
  __dirname,
  "../../server/src/services/ship/shipService",
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
  getAttributeIDByNames,
  buildChargeTupleItemID,
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
  return maxItemID + 7000;
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
    clientID: candidate.characterID + 9900,
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

function getNotificationItems(entry) {
  const payload =
    entry &&
    Array.isArray(entry.payload) &&
    entry.payload.length > 0
      ? entry.payload[0]
      : null;
  if (payload && payload.type === "list" && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function parseItemChange(entry) {
  if (!entry || entry.name !== "OnItemChange" || !Array.isArray(entry.payload)) {
    return null;
  }

  const row = entry.payload[0];
  const fields = row && row.type === "packedrow" ? row.fields : null;
  const changeDict = entry.payload[1];
  const changedColumns =
    changeDict && changeDict.type === "dict" && Array.isArray(changeDict.entries)
      ? new Map(changeDict.entries)
      : new Map();
  if (!fields) {
    return null;
  }

  return {
    itemID: Number(fields.itemID) || 0,
    locationID: Number(fields.locationID) || 0,
    flagID: Number(fields.flagID) || 0,
    quantity: Number(fields.quantity),
    stacksize: Number(fields.stacksize),
    changedColumns,
  };
}

function findModuleAttributeChange(
  notifications,
  itemIDMatcher,
  attributeID,
  newValue,
  oldValue,
) {
  for (const entry of notifications || []) {
    if (!entry || entry.name !== "OnModuleAttributeChanges") {
      continue;
    }
    for (const change of getNotificationItems(entry)) {
      if (!Array.isArray(change) || Number(change[3]) !== Number(attributeID)) {
        continue;
      }
      const itemID = change[2];
      if (!itemIDMatcher(itemID)) {
        continue;
      }
      if (
        (newValue === undefined || Number(change[5]) === Number(newValue)) &&
        (oldValue === undefined || Number(change[6]) === Number(oldValue))
      ) {
        return change;
      }
    }
  }
  return null;
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
        chargeCapacity: capacity,
        freeHighFlag,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked character with at least one high slot");
  const candidate = candidates[0];
  const preexistingCargoChargeStacks = listContainerItems(
    candidate.characterID,
    candidate.activeShip.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => Number(item.typeID) === Number(chargeType.match.typeID));

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const shipService = new ShipService();
  const notifications = [];
  const quantityAttributeID = getAttributeIDByNames("quantity") || 805;
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
        locationID: candidate.activeShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: chargeType.match.name,
        quantity: candidate.chargeCapacity + 12,
        stacksize: candidate.chargeCapacity + 12,
        singleton: 0,
      }),
    );

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
        {
          type: "list",
          items: [sourceChargeStackID],
        },
        candidate.activeShip.itemID,
      ],
      session,
    );

    const loadedCharge = getLoadedChargeByFlag(
      candidate.characterID,
      candidate.activeShip.itemID,
      candidate.freeHighFlag,
    );
    assert(
      loadedCharge,
      "Expected LoadAmmo to accept marshal-list charge args and create a loaded charge",
    );
    loadedChargeItemID = Number(loadedCharge.itemID) || null;
    assert(loadedChargeItemID, "Expected loaded charge item to have a real itemID");
    assert.notStrictEqual(
      loadedChargeItemID,
      sourceChargeStackID,
      "Expected a partial cargo load to create a new loaded-charge item",
    );
    tempItemIDs.add(loadedChargeItemID);

    const remainingCargoStack = findItemById(sourceChargeStackID);
    assert(remainingCargoStack, "Expected source cargo stack to remain after partial load");
    assert.strictEqual(
      Number(remainingCargoStack.locationID),
      Number(candidate.activeShip.itemID),
      "Expected remaining ammo stack to stay inside the ship",
    );
    assert.strictEqual(
      Number(remainingCargoStack.flagID),
      Number(ITEM_FLAGS.CARGO_HOLD),
      "Expected remaining ammo stack to stay in cargo",
    );
    assert.strictEqual(
      Number(remainingCargoStack.stacksize),
      12,
      "Expected source cargo stack to keep only the leftover rounds",
    );
    assert.strictEqual(
      Number(loadedCharge.stacksize),
      Number(candidate.chargeCapacity),
      "Expected launcher load to fill exactly module capacity",
    );
    assert.strictEqual(
      Number(loadedCharge.locationID),
      Number(candidate.activeShip.itemID),
      "Expected loaded charge to move into the ship inventory location",
    );
    assert.strictEqual(
      Number(loadedCharge.flagID),
      Number(candidate.freeHighFlag),
      "Expected loaded charge to occupy the same flag as its launcher",
    );

    const activationResponse = shipService._buildActivationResponse(
      candidate.activeShip,
      session,
    );
    const activationInstanceRows = new Map(
      activationResponse &&
      Array.isArray(activationResponse) &&
      activationResponse[0] &&
      activationResponse[0].type === "dict"
        ? activationResponse[0].entries
        : [],
    );
    assert(
      activationInstanceRows.has(launcherItemID),
      "Expected ship activation state to include the fitted launcher instance row",
    );
    assert(
      !activationInstanceRows.has(loadedChargeItemID),
      "Expected ship activation state to exclude loaded charge inventory rows and rely on charge sublocations instead",
    );

    const expectedChargeTupleItemID = buildChargeTupleItemID(
      candidate.activeShip.itemID,
      candidate.freeHighFlag,
      chargeType.match.typeID,
    );
    const loadQuantityChange = findModuleAttributeChange(
      notifications,
      (itemID) =>
        Array.isArray(itemID) &&
        JSON.stringify(itemID) === JSON.stringify(expectedChargeTupleItemID),
      quantityAttributeID,
      candidate.chargeCapacity,
      0,
    );
    assert(
      loadQuantityChange,
      "Expected LoadAmmo to emit OnModuleAttributeChanges for the charge tuple quantity",
    );

    notifications.length = 0;

    dogma.Handle_UnloadAmmo(
      [
        candidate.activeShip.itemID,
        launcherItemID,
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
      "Expected UnloadAmmo to remove the loaded charge from the launcher",
    );
    const unloadQuantityChange = findModuleAttributeChange(
      notifications,
      (itemID) =>
        Array.isArray(itemID) &&
        JSON.stringify(itemID) === JSON.stringify(expectedChargeTupleItemID),
      quantityAttributeID,
      0,
      candidate.chargeCapacity,
    );
    assert(
      unloadQuantityChange,
      "Expected UnloadAmmo to emit OnModuleAttributeChanges clearing the charge tuple quantity",
    );
    const cargoStacksAfterUnload = listContainerItems(
      candidate.characterID,
      candidate.activeShip.itemID,
      ITEM_FLAGS.CARGO_HOLD,
    ).filter((item) => Number(item.typeID) === Number(chargeType.match.typeID));
    const restoredCargoStack = cargoStacksAfterUnload.find(
      (item) => Number(item.itemID) === Number(sourceChargeStackID),
    );
    assert.strictEqual(
      cargoStacksAfterUnload.length,
      preexistingCargoChargeStacks.length + 1,
      "Expected unloading into cargo to restore only the original test cargo stack, without creating any extra same-type duplicate rows",
    );
    assert.strictEqual(
      Number(restoredCargoStack && restoredCargoStack.itemID),
      Number(sourceChargeStackID),
      "Expected the original cargo stack to be reused on unload",
    );
    assert.strictEqual(
      Number(restoredCargoStack && restoredCargoStack.stacksize),
      Number(candidate.chargeCapacity + 12),
      "Expected unloading to restore the source cargo stack quantity exactly",
    );
    assert.strictEqual(
      findItemById(loadedChargeItemID),
      null,
      "Expected unloading to remove the temporary loaded-charge item row once its ammo is back in cargo",
    );
    const unloadItemChanges = notifications
      .filter((entry) => entry && entry.name === "OnItemChange")
      .map(parseItemChange)
      .filter(Boolean);
    const restoredCargoChange = unloadItemChanges.find(
      (change) => change.itemID === Number(sourceChargeStackID),
    );
    assert(
      restoredCargoChange,
      "Expected unload to update the original cargo stack live",
    );
    assert.strictEqual(
      restoredCargoChange.stacksize,
      Number(candidate.chargeCapacity + 12),
      "Expected the live cargo stack refresh to show the merged ammo quantity",
    );
    const removedLoadedChargeChange = unloadItemChanges.find(
      (change) => change.itemID === Number(loadedChargeItemID),
    );
    assert(
      removedLoadedChargeChange,
      "Expected unload to notify the client that the temporary loaded-charge row was removed",
    );
    assert.notStrictEqual(
      removedLoadedChargeChange.locationID,
      Number(candidate.activeShip.itemID),
      "Expected the removed loaded-charge notification to leave the ship inventory instead of masquerading as a cargo move",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      launcherItemID,
      sourceChargeStackID,
      loadedChargeItemID,
      launcherFlagID: candidate.freeHighFlag,
      chargeCapacity: candidate.chargeCapacity,
      quantityAttributeID,
    }));
  } finally {
    if (loadedChargeItemID) {
      removeItemIfPresent(loadedChargeItemID);
    }
    for (const itemID of tempItemIDs) {
      removeItemIfPresent(itemID);
    }
  }
}

main();
