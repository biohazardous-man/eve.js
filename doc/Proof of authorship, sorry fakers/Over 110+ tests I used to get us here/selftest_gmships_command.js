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
const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const { getUnpublishedShipTypes } = require(path.join(
  __dirname,
  "../../server/src/services/chat/shipTypeRegistry",
));
const { getCharacterHangarShipItems } = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const TEST_STATION_ID = 60003760;

function main() {
  const unpublishedShips = getUnpublishedShipTypes();
  assert(
    unpublishedShips.length > 0,
    "Expected unpublished ship types to be available in local reference data",
  );

  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");
  const testCharId = Number(
    Object.keys(charactersResult.data || {}).find((key) => Number(key) > 0),
  );
  assert(Number.isInteger(testCharId) && testCharId > 0, "Expected at least one character");

  const beforeDocked = getCharacterHangarShipItems(testCharId, TEST_STATION_ID);
  const beforeDockedIDs = new Set(beforeDocked.map((ship) => Number(ship.itemID)));

  const inSpaceResult = executeChatCommand(
    { characterID: testCharId, solarsystemid2: 30000142 },
    "/gmships",
    null,
    { emitChatFeedback: false },
  );
  assert.strictEqual(inSpaceResult.handled, true, "Command should be handled while in space");
  assert(
    inSpaceResult.message.includes("must be docked"),
    "In-space /gmships should refuse to run",
  );

  const dockedSession = {
    characterID: testCharId,
    stationid: TEST_STATION_ID,
    sendNotification() {},
  };

  let createdIDs = [];

  try {
    const dockedResult = executeChatCommand(
      dockedSession,
      "/gmships",
      null,
      { emitChatFeedback: false },
    );

    assert.strictEqual(dockedResult.handled, true, "Docked command should be handled");
    assert(
      dockedResult.message.includes(`Added ${unpublishedShips.length}/${unpublishedShips.length}`),
      "Feedback should report the unpublished ship count",
    );

    const afterDocked = getCharacterHangarShipItems(testCharId, TEST_STATION_ID);
    createdIDs = afterDocked
      .map((ship) => Number(ship.itemID))
      .filter((itemID) => !beforeDockedIDs.has(itemID));

    assert.strictEqual(
      createdIDs.length,
      unpublishedShips.length,
      "Docked /gmships should add every unpublished ship to the current station hangar",
    );

    const createdTypeIDs = new Set(
      afterDocked
        .filter((ship) => createdIDs.includes(Number(ship.itemID)))
        .map((ship) => Number(ship.typeID)),
    );

    assert(
      unpublishedShips.every((shipType) => createdTypeIDs.has(Number(shipType.typeID))),
      "Created hangar ships should cover the full unpublished ship set",
    );

    console.log(JSON.stringify({
      ok: true,
      testCharId,
      stationID: TEST_STATION_ID,
      unpublishedShipCount: unpublishedShips.length,
      message: dockedResult.message,
    }, null, 2));
  } finally {
    for (const itemID of createdIDs) {
      database.remove("items", `/${itemID}`);
    }
  }
}

main();
