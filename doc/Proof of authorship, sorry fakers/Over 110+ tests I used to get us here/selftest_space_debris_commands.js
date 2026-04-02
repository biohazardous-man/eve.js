/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const {
  executeChatCommand,
} = require(path.join(__dirname, "../../server/src/services/chat/chatCommands"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../../server/src/services/character/characterState"));
const {
  buildShipItem,
  createSpaceItemForCharacter,
  findItemById,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemTypeRegistry"));
const {
  clearSystemDebrisForSession,
} = require(path.join(__dirname, "../../server/src/services/inventory/spaceDebrisState"));

const TEST_SYSTEM_ID = 30002187;
const TEST_SHIP_POSITION = { x: 2_500_000, y: 1_500_000, z: -750_000 };

function getFirstCharacterId() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");
  const characterID = Number(
    Object.keys(charactersResult.data || {}).find((key) => Number(key) > 0),
  );
  assert(Number.isInteger(characterID) && characterID > 0, "Expected at least one character");
  return characterID;
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

function distance(left, right) {
  const dx = Number(left.x || 0) - Number(right.x || 0);
  const dy = Number(left.y || 0) - Number(right.y || 0);
  const dz = Number(left.z || 0) - Number(right.z || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function buildSession(characterID, shipItem) {
  const characterRecord = getCharacterRecord(characterID);
  return {
    clientID: characterID + 80100,
    characterID,
    charid: characterID,
    userid: characterID,
    characterName: characterRecord && characterRecord.characterName || `char-${characterID}`,
    corporationID: Number(characterRecord && characterRecord.corporationID || 0),
    allianceID: Number(characterRecord && characterRecord.allianceID || 0),
    warFactionID: Number(characterRecord && characterRecord.factionID || 0),
    shipID: shipItem.itemID,
    shipid: shipItem.itemID,
    activeShipID: shipItem.itemID,
    shipName: shipItem.itemName,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    shipItem,
  };
}

function main() {
  const characterID = getFirstCharacterId();
  const shipItemID = getNextTemporaryItemID();
  const shipItem = buildShipItem({
    itemID: shipItemID,
    typeID: 606,
    ownerID: characterID,
    locationID: TEST_SYSTEM_ID,
    flagID: 0,
    itemName: "Parity Debris Test Ship",
    spaceState: {
      systemID: TEST_SYSTEM_ID,
      position: TEST_SHIP_POSITION,
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      targetPoint: TEST_SHIP_POSITION,
      speedFraction: 0,
      mode: "STOP",
    },
  });

  writeTemporaryItem(shipItemID, shipItem);
  const session = buildSession(characterID, shipItem);
  const cargoContainer = resolveItemByName("Cargo Container");
  const frigateWreck = resolveItemByName("Frigate Wreck");
  assert(cargoContainer.success, "Expected Cargo Container type");
  assert(frigateWreck.success, "Expected Frigate Wreck type");

  try {
    runtime._testing.clearScenes();
    runtime.attachSession(session, shipItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.strictEqual(runtime.ensureInitialBallpark(session), true);
    assert.strictEqual(
      clearSystemDebrisForSession(session).success,
      true,
      "Expected isolated debris test system cleanup to succeed",
    );

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const beforeDebrisIDs = new Set(
      scene.getDynamicEntities()
        .filter((entity) => entity.kind === "container" || entity.kind === "wreck")
        .map((entity) => Number(entity.itemID)),
    );

    const containerResult = executeChatCommand(
      session,
      "/container 3",
      null,
      { emitChatFeedback: false },
    );
    const wreckResult = executeChatCommand(
      session,
      "/wreck 4",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(containerResult.handled, true);
    assert.strictEqual(wreckResult.handled, true);
    assert(containerResult.message.includes("Spawned 3/3"));
    assert(wreckResult.message.includes("Spawned 4/4"));

    const createdDebris = scene.getDynamicEntities()
      .filter((entity) =>
        (entity.kind === "container" || entity.kind === "wreck") &&
        !beforeDebrisIDs.has(Number(entity.itemID)),
      );
    const createdContainers = createdDebris.filter((entity) => entity.kind === "container");
    const createdWrecks = createdDebris.filter((entity) => entity.kind === "wreck");
    assert.strictEqual(createdContainers.length, 3, "Expected three spawned containers");
    assert.strictEqual(createdWrecks.length, 4, "Expected four spawned wrecks");

    for (const entity of createdDebris) {
      assert(
        distance(entity.position, shipItem.spaceState.position) <= 20_000,
        "Expected debris to spawn within 20 km of the player ship",
      );
      assert(
        listContainerItems(null, entity.itemID).length > 0,
        "Expected spawned debris to contain loot",
      );
    }

    for (let index = 0; index < createdDebris.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < createdDebris.length; otherIndex += 1) {
        assert(
          distance(createdDebris[index].position, createdDebris[otherIndex].position) > 250,
          "Expected spawned debris not to overlap each other",
        );
      }
    }

    const createdIDs = createdDebris.map((entity) => Number(entity.itemID));

    runtime.detachSession(session, { broadcast: false });
    runtime._testing.clearScenes();

    const reloadedScene = runtime.ensureScene(TEST_SYSTEM_ID);
    for (const createdID of createdIDs) {
      assert(
        reloadedScene.getEntityByID(createdID),
        `Expected debris ${createdID} to persist across scene reload`,
      );
    }

    runtime.attachSession(session, shipItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.strictEqual(runtime.ensureInitialBallpark(session), true);

    const clearResult = executeChatCommand(
      session,
      "/testclear",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(clearResult.handled, true);
    assert(clearResult.message.includes("Cleared"));

    const liveScene = runtime.ensureScene(TEST_SYSTEM_ID);
    for (const createdID of createdIDs) {
      assert.strictEqual(
        liveScene.getEntityByID(createdID),
        null,
        `Expected debris ${createdID} to be gone from the scene after /testclear`,
      );
    }

    const farContainerResult = createSpaceItemForCharacter(
      characterID,
      TEST_SYSTEM_ID,
      cargoContainer.match,
      {
        itemName: "Parity System Clear Container",
        position: { x: 250_000, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
      },
    );
    const farWreckResult = createSpaceItemForCharacter(
      characterID,
      TEST_SYSTEM_ID,
      frigateWreck.match,
      {
        itemName: "Parity System Clear Wreck",
        position: { x: 275_000, y: 0, z: 0 },
        direction: { x: -1, y: 0, z: 0 },
      },
    );
    assert.strictEqual(farContainerResult.success, true, "Expected far system container create");
    assert.strictEqual(farWreckResult.success, true, "Expected far system wreck create");
    const farContainerID = Number(farContainerResult.data.itemID);
    const farWreckID = Number(farWreckResult.data.itemID);
    assert.strictEqual(
      runtime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, farContainerID).success,
      true,
      "Expected far system container ball spawn",
    );
    assert.strictEqual(
      runtime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, farWreckID).success,
      true,
      "Expected far system wreck ball spawn",
    );

    const systemClearResult = executeChatCommand(
      session,
      "/sysjunkclear",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(systemClearResult.handled, true);
    assert(systemClearResult.message.includes("Cleared"));
    assert.strictEqual(
      runtime.ensureScene(TEST_SYSTEM_ID).getEntityByID(farContainerID),
      null,
      "Expected /sysjunkclear to remove containers anywhere in the system",
    );
    assert.strictEqual(
      runtime.ensureScene(TEST_SYSTEM_ID).getEntityByID(farWreckID),
      null,
      "Expected /sysjunkclear to remove wrecks anywhere in the system",
    );
    assert.strictEqual(
      findItemById(farContainerID),
      null,
      "Expected /sysjunkclear to remove system containers from inventory",
    );
    assert.strictEqual(
      findItemById(farWreckID),
      null,
      "Expected /sysjunkclear to remove system wrecks from inventory",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID,
      shipItemID,
      createdContainerIDs: createdContainers.map((entity) => entity.itemID),
      createdWreckIDs: createdWrecks.map((entity) => entity.itemID),
      clearMessage: clearResult.message,
      systemClearMessage: systemClearResult.message,
    }, null, 2));
  } finally {
    runtime.detachSession(session, { broadcast: false });
    runtime._testing.clearScenes();
    for (const maybeItemID of Object.keys(database.read("items", "/").data || {})) {
      const numericItemID = Number(maybeItemID) || 0;
      if (numericItemID === shipItemID) {
        removeInventoryItem(shipItemID, { removeContents: true });
      }
    }
    if (findItemById(shipItemID)) {
      removeInventoryItem(shipItemID, { removeContents: true });
    }
  }
}

main();
