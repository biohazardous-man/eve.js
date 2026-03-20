const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  takeItemTypeFromCharacterLocation,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const TEST_STATION_ID = 60003760;
const TEST_TYPE_ID = 34;

function getCharacterId() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");
  const testCharId = Number(
    Object.keys(charactersResult.data || {}).find((key) => Number(key) > 0),
  );
  assert(Number.isInteger(testCharId) && testCharId > 0, "Expected at least one character");
  return testCharId;
}

function getHangarTypeItems(charId, typeId) {
  return listContainerItems(charId, TEST_STATION_ID, ITEM_FLAGS.HANGAR)
    .filter((item) => Number(item.typeID) === Number(typeId));
}

function totalQuantity(items) {
  return items.reduce(
    (sum, item) => sum + (Number(item.singleton) === 1 ? 1 : Number(item.quantity || 0)),
    0,
  );
}

function main() {
  const itemType = resolveItemByTypeID(TEST_TYPE_ID);
  assert(itemType, `Expected item type ${TEST_TYPE_ID} to be available`);

  const testCharId = getCharacterId();
  const itemsRoot = database.read("items", "/");
  assert(itemsRoot.success, "Failed to read items table");

  const beforeItems = getHangarTypeItems(testCharId, TEST_TYPE_ID);
  const beforeIds = new Set(beforeItems.map((item) => Number(item.itemID)));
  const originalEntries = new Map(
    beforeItems.map((item) => [
      Number(item.itemID),
      itemsRoot.data[String(item.itemID)],
    ]),
  );

  try {
    const inSpaceResult = executeChatCommand(
      { characterID: testCharId, solarsystemid2: 30000142 },
      `/giveitem ${TEST_TYPE_ID} 5`,
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(inSpaceResult.handled, true, "Command should be handled in space");
    assert(
      inSpaceResult.message.includes("must be docked"),
      "In-space /giveitem should refuse to run",
    );

    const dockedSession = {
      characterID: testCharId,
      stationid: TEST_STATION_ID,
      sendNotification() {},
    };

    const firstResult = executeChatCommand(
      dockedSession,
      `/giveitem ${itemType.name} 5`,
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(firstResult.handled, true, "First docked /giveitem should be handled");
    assert(
      firstResult.message.includes(itemType.name),
      "Feedback should mention the granted item type",
    );

    const secondResult = executeChatCommand(
      dockedSession,
      `/giveitem ${TEST_TYPE_ID} 3`,
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(secondResult.handled, true, "Second docked /giveitem should be handled");

    const afterGrant = getHangarTypeItems(testCharId, TEST_TYPE_ID);
    assert.strictEqual(
      totalQuantity(afterGrant),
      totalQuantity(beforeItems) + 8,
      "/giveitem should increase the hangar quantity by the granted amount",
    );

    const takeResult = takeItemTypeFromCharacterLocation(
      testCharId,
      TEST_STATION_ID,
      ITEM_FLAGS.HANGAR,
      TEST_TYPE_ID,
      2,
    );
    assert.strictEqual(takeResult.success, true, "takeItemTypeFromCharacterLocation should succeed");

    const afterTake = getHangarTypeItems(testCharId, TEST_TYPE_ID);
    assert.strictEqual(
      totalQuantity(afterTake),
      totalQuantity(beforeItems) + 6,
      "Generic take flow should remove quantity from the same hangar inventory",
    );

    console.log(JSON.stringify({
      ok: true,
      testCharId,
      stationID: TEST_STATION_ID,
      typeID: TEST_TYPE_ID,
      itemName: itemType.name,
      beforeQuantity: totalQuantity(beforeItems),
      afterQuantity: totalQuantity(afterTake),
      message: secondResult.message,
    }, null, 2));
  } finally {
    const currentItems = getHangarTypeItems(testCharId, TEST_TYPE_ID);
    for (const item of currentItems) {
      const itemID = Number(item.itemID);
      if (originalEntries.has(itemID)) {
        database.write("items", `/${itemID}`, originalEntries.get(itemID));
      } else {
        database.remove("items", `/${itemID}`);
      }
    }

    for (const itemID of beforeIds) {
      if (!database.read("items", `/${itemID}`).success && originalEntries.has(itemID)) {
        database.write("items", `/${itemID}`, originalEntries.get(itemID));
      }
    }
  }
}

main();
