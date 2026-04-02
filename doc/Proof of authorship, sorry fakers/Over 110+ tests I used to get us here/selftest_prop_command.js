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
const {
  executeChatCommand,
  getPropulsionCommandItemTypes,
} = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const {
  ITEM_FLAGS,
  listContainerItems,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");

  const characterID = Number(
    Object.keys(charactersResult.data || {}).find((key) => {
      const record = charactersResult.data[key];
      return Number(key) > 0 && Number(record && (record.stationID || record.stationid || 0)) > 0;
    }),
  );
  assert(Number.isInteger(characterID) && characterID > 0, "Expected a docked character");

  const characterRecord = charactersResult.data[String(characterID)] || {};
  const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
  assert(stationID > 0, "Expected docked candidate station ID");
  return {
    characterID,
    stationID,
  };
}

function getHangarItems(characterID, stationID) {
  return listContainerItems(characterID, stationID, ITEM_FLAGS.HANGAR);
}

function buildTypeCountMap(items) {
  const counts = new Map();
  for (const item of items) {
    const typeID = Number(item && item.typeID) || 0;
    if (typeID <= 0) {
      continue;
    }
    const amount = Number(item && item.singleton) === 1
      ? 1
      : Number(item && (item.quantity || item.stacksize || 0)) || 0;
    counts.set(typeID, (counts.get(typeID) || 0) + amount);
  }
  return counts;
}

function main() {
  const candidate = getDockedCandidate();
  const propulsionTypes = getPropulsionCommandItemTypes();
  assert(propulsionTypes.length > 0, "Expected /prop to resolve propulsion module types");

  const beforeItems = getHangarItems(candidate.characterID, candidate.stationID);
  const beforeTypeCounts = buildTypeCountMap(beforeItems);
  const beforeItemIDs = new Set(beforeItems.map((item) => Number(item.itemID)));
  const originalRecords = new Map(
    beforeItems.map((item) => [
      Number(item.itemID),
      database.read("items", `/${item.itemID}`).data,
    ]),
  );

  try {
    const inSpaceResult = executeChatCommand(
      { characterID: candidate.characterID, solarsystemid2: 30000142 },
      "/prop",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(inSpaceResult.handled, true, "Expected in-space /prop to be handled");
    assert(
      inSpaceResult.message.includes("must be docked"),
      "Expected in-space /prop to require docking",
    );

    const dockedResult = executeChatCommand(
      {
        characterID: candidate.characterID,
        stationid: candidate.stationID,
        stationID: candidate.stationID,
        sendNotification() {},
      },
      "/prop",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(dockedResult.handled, true, "Expected docked /prop to be handled");
    assert(
      dockedResult.message.includes("propulsion modules"),
      "Expected /prop feedback to mention propulsion modules",
    );

    const afterItems = getHangarItems(candidate.characterID, candidate.stationID);
    const afterTypeCounts = buildTypeCountMap(afterItems);
    for (const itemType of propulsionTypes) {
      const typeID = Number(itemType.typeID) || 0;
      const beforeCount = beforeTypeCounts.get(typeID) || 0;
      const afterCount = afterTypeCounts.get(typeID) || 0;
      assert.strictEqual(
        afterCount,
        beforeCount + 1,
        `Expected /prop to add exactly one ${itemType.name} (${typeID})`,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      stationID: candidate.stationID,
      grantedTypeCount: propulsionTypes.length,
      sampleNames: propulsionTypes.slice(0, 8).map((itemType) => itemType.name),
      message: dockedResult.message,
    }, null, 2));
  } finally {
    const currentItems = getHangarItems(candidate.characterID, candidate.stationID);
    for (const item of currentItems) {
      const itemID = Number(item.itemID);
      if (beforeItemIDs.has(itemID)) {
        const originalRecord = originalRecords.get(itemID);
        if (originalRecord) {
          database.write("items", `/${itemID}`, originalRecord);
        }
      } else {
        database.remove("items", `/${itemID}`);
      }
    }
  }
}

main();
