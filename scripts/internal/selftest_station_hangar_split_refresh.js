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
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
  mergeItemStacks,
  moveItemToLocation,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const TEST_TYPE_ID = 34;

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");

  for (const rawCharacterID of Object.keys(charactersResult.data || {})) {
    const characterID = Number(rawCharacterID) || 0;
    if (characterID <= 0) {
      continue;
    }

    const characterRecord = getCharacterRecord(characterID);
    const stationID = Number(
      characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
    );
    if (stationID > 0) {
      return {
        characterID,
        stationID,
        characterRecord,
      };
    }
  }

  return null;
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

function getChangeEntries(notification) {
  const payload = notification && notification.payload;
  if (!Array.isArray(payload) || payload.length < 2) {
    return [];
  }
  const changeDict = payload[1];
  return Array.isArray(changeDict && changeDict.entries)
    ? changeDict.entries
    : [];
}

function main() {
  const candidate = getDockedCandidate();
  assert(candidate, "Expected at least one docked character");

  const invBroker = new InvBrokerService();
  const notifications = [];
  const session = {
    clientID: candidate.characterID + 12000,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    characterName: candidate.characterRecord.characterName,
    sendNotification(name, narrowcast, payload) {
      notifications.push({ name, narrowcast, payload });
    },
  };

  const sourceStackID = getNextTemporaryItemID();
  let splitItemID = null;

  try {
    writeTemporaryItem(
      sourceStackID,
      buildInventoryItem({
        itemID: sourceStackID,
        typeID: TEST_TYPE_ID,
        ownerID: candidate.characterID,
        locationID: candidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: "Tritanium",
        singleton: 0,
        quantity: 50,
        stacksize: 50,
      }),
    );

    const moveResult = moveItemToLocation(
      sourceStackID,
      candidate.stationID,
      ITEM_FLAGS.HANGAR,
      10,
    );
    assert.strictEqual(moveResult.success, true, "Expected same-container split to succeed");
    assert(Array.isArray(moveResult.data && moveResult.data.changes));
    assert.strictEqual(moveResult.data.changes.length, 2);

    const sourceChange = moveResult.data.changes.find(
      (change) => Number(change && change.item && change.item.itemID) === sourceStackID,
    );
    const createdChange = moveResult.data.changes.find(
      (change) => Number(change && change.item && change.item.itemID) !== sourceStackID,
    );
    assert(sourceChange, "Expected source stack change");
    assert(createdChange, "Expected created split item change");

    splitItemID = Number(createdChange.item.itemID) || null;
    assert(splitItemID && splitItemID > 0, "Expected created split item to have a real itemID");
    assert.strictEqual(Number(createdChange.item.locationID), candidate.stationID);
    assert.strictEqual(Number(createdChange.item.flagID), ITEM_FLAGS.HANGAR);
    assert.strictEqual(Number(createdChange.item.stacksize), 10);
    assert.strictEqual(
      Number(createdChange.previousData && createdChange.previousData.locationID),
      0,
      "Expected created split rows to advertise arrival from outside the container",
    );

    invBroker._emitInventoryMoveChanges(session, moveResult.data.changes);

    const itemChanges = notifications.filter((entry) => entry.name === "OnItemChange");
    assert.strictEqual(itemChanges.length, 2, "Expected one OnItemChange per split change");

    const createdNotification = itemChanges.find((entry) => {
      const payload = entry.payload && entry.payload[0];
      return payload && payload.fields && Number(payload.fields.itemID) === splitItemID;
    });
    assert(createdNotification, "Expected created split item notification");

    const changeEntries = getChangeEntries(createdNotification);
    assert(
      changeEntries.length > 0,
      "Expected created split item notification to carry a non-empty change dict",
    );
    assert(
      changeEntries.some(([, previousValue]) => Number(previousValue) === 0),
      "Expected created split item notification to include a synthetic previous value",
    );

    const splitItem = findItemById(splitItemID);
    assert(splitItem, "Expected created split item to be persisted");
    assert.strictEqual(Number(splitItem.locationID), candidate.stationID);
    assert.strictEqual(Number(splitItem.flagID), ITEM_FLAGS.HANGAR);

    notifications.length = 0;

    const mergeResult = mergeItemStacks(splitItemID, sourceStackID);
    assert.strictEqual(mergeResult.success, true, "Expected same-container merge to succeed");
    invBroker._emitInventoryMoveChanges(session, mergeResult.data.changes);

    const mergedSourceStack = findItemById(sourceStackID);
    assert(mergedSourceStack, "Expected destination stack to remain after merge");
    assert.strictEqual(Number(mergedSourceStack.stacksize), 50);

    const mergeNotifications = notifications.filter((entry) => entry.name === "OnItemChange");
    assert.strictEqual(mergeNotifications.length, 2, "Expected one OnItemChange per merge change");
    const removedMergeNotification = mergeNotifications.find((entry) => {
      const payload = entry.payload && entry.payload[0];
      return payload && payload.fields && Number(payload.fields.itemID) === splitItemID;
    });
    assert(removedMergeNotification, "Expected removed split item notification");
    const removedPayload = removedMergeNotification.payload && removedMergeNotification.payload[0];
    assert.strictEqual(
      Number(removedPayload && removedPayload.fields && removedPayload.fields.locationID),
      6,
      "Expected removed stack notifications to present the row as moved to junk",
    );
    const removedEntries = getChangeEntries(removedMergeNotification);
    assert(
      removedEntries.some(([, previousValue]) => Number(previousValue) > 0),
      "Expected removed split item notification to carry previous stack details",
    );

    console.log("selftest_station_hangar_split_refresh: ok");
  } finally {
    if (splitItemID) {
      removeItemIfPresent(splitItemID);
    }
    removeItemIfPresent(sourceStackID);
  }
}

main();
