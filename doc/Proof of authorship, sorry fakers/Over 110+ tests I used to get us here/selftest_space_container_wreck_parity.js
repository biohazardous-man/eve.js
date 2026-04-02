/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const InvBrokerService = require(path.join(
  __dirname,
  "../../server/src/services/inventory/invBrokerService",
));
const {
  resolveItemByName,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  ITEM_FLAGS,
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  listContainerItems,
  takeItemTypeFromCharacterLocation,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const TEST_SYSTEM_ID = 30000142;

function createFakeSession(clientID, characterID, systemID, position, direction) {
  const notifications = [];
  return {
    clientID,
    characterID,
    charid: characterID,
    userid: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        systemID,
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachReadySession(session) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
}

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

function getFirstCharacterId() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");
  const characterID = Number(
    Object.keys(charactersResult.data || {}).find((key) => Number(key) > 0),
  );
  assert(Number.isInteger(characterID) && characterID > 0, "Expected one character");
  return characterID;
}

function deleteItemCascade(itemID) {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items table");
  const items = itemsResult.data || {};
  const idsToDelete = new Set();
  const walk = (currentID) => {
    idsToDelete.add(Number(currentID));
    for (const [itemKey, rawItem] of Object.entries(items)) {
      if (Number(rawItem && rawItem.locationID) === Number(currentID)) {
        const numericItemID = Number(itemKey) || 0;
        if (numericItemID > 0 && !idsToDelete.has(numericItemID)) {
          walk(numericItemID);
        }
      }
    }
  };
  walk(itemID);
  for (const id of idsToDelete) {
    database.remove("items", `/${id}`);
  }
}

function main() {
  const characterID = getFirstCharacterId();
  const invBroker = new InvBrokerService();
  const cargoContainer = resolveItemByName("Cargo Container");
  const frigateWreck = resolveItemByName("Frigate Wreck");
  const tritanium = resolveItemByName("Tritanium");

  assert(cargoContainer.success, "Expected Cargo Container type");
  assert(frigateWreck.success, "Expected Frigate Wreck type");
  assert(tritanium.success, "Expected Tritanium type");

  const nearSession = createFakeSession(
    991001,
    992001,
    TEST_SYSTEM_ID,
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const farSession = createFakeSession(
    991002,
    992002,
    TEST_SYSTEM_ID,
    { x: runtime._testing.PUBLIC_GRID_BOX_METERS * 2, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  );

  let containerItemID = null;
  let wreckItemID = null;

  try {
    runtime._testing.clearScenes();
    attachReadySession(nearSession);
    attachReadySession(farSession);
    nearSession.notifications.length = 0;
    farSession.notifications.length = 0;

    const containerResult = createSpaceItemForCharacter(
      characterID,
      TEST_SYSTEM_ID,
      cargoContainer.match,
      {
        itemName: "Parity Test Container",
        position: { x: 800, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
      },
    );
    const wreckResult = createSpaceItemForCharacter(
      characterID,
      TEST_SYSTEM_ID,
      frigateWreck.match,
      {
        itemName: "Parity Test Wreck",
        position: { x: 1200, y: 0, z: 0 },
        direction: { x: -1, y: 0, z: 0 },
      },
    );
    assert.strictEqual(containerResult.success, true, "Expected space container create to succeed");
    assert.strictEqual(wreckResult.success, true, "Expected wreck create to succeed");

    containerItemID = Number(containerResult.data.itemID);
    wreckItemID = Number(wreckResult.data.itemID);

    const lootIntoContainer = grantItemToCharacterLocation(
      characterID,
      containerItemID,
      ITEM_FLAGS.HANGAR,
      tritanium.match,
      25,
    );
    const lootIntoWreck = grantItemToCharacterLocation(
      characterID,
      wreckItemID,
      ITEM_FLAGS.HANGAR,
      tritanium.match,
      10,
    );
    assert.strictEqual(lootIntoContainer.success, true);
    assert.strictEqual(lootIntoWreck.success, true);

    const spawnContainer = runtime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, containerItemID);
    const spawnWreck = runtime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, wreckItemID);
    assert.strictEqual(spawnContainer.success, true, "Expected container ball spawn");
    assert.strictEqual(spawnWreck.success, true, "Expected wreck ball spawn");

    const nearNames = flattenDestinyPayloadNames(nearSession.notifications);
    const farNames = flattenDestinyPayloadNames(farSession.notifications);
    assert(
      nearNames.filter((name) => name === "AddBalls2").length >= 2,
      "Near observer should receive AddBalls2 for spawned debris",
    );
    assert(
      !farNames.includes("AddBalls2"),
      "Far observer should not receive debris AddBalls2 outside the public grid",
    );

    let scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const containerEntity = scene.getEntityByID(containerItemID);
    const wreckEntity = scene.getEntityByID(wreckItemID);
    assert(containerEntity && containerEntity.kind === "container");
    assert(wreckEntity && wreckEntity.kind === "wreck");
    assert.strictEqual(containerEntity.isEmpty, false, "Expected non-empty spawned container");
    assert.strictEqual(wreckEntity.isEmpty, false, "Expected non-empty spawned wreck");

    nearSession.notifications.length = 0;
    const emptyResult = takeItemTypeFromCharacterLocation(
      characterID,
      containerItemID,
      ITEM_FLAGS.HANGAR,
      tritanium.match.typeID,
      25,
    );
    assert.strictEqual(emptyResult.success, true, "Expected taking all container loot to succeed");
    invBroker._refreshBallparkInventoryPresentation(
      nearSession,
      emptyResult.data && emptyResult.data.changes,
    );

    const slimNames = flattenDestinyPayloadNames(nearSession.notifications);
    assert(
      slimNames.includes("OnSlimItemChange"),
      "Expected inventory refresh to push a slim update for emptied container",
    );
    assert.strictEqual(listContainerItems(null, containerItemID).length, 0);

    runtime.detachSession(nearSession, { broadcast: false });
    runtime.detachSession(farSession, { broadcast: false });
    runtime._testing.clearScenes();

    scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const reloadedContainer = scene.getEntityByID(containerItemID);
    const reloadedWreck = scene.getEntityByID(wreckItemID);
    assert(reloadedContainer, "Expected container to reload from persisted inventory state");
    assert(reloadedWreck, "Expected wreck to reload from persisted inventory state");
    assert.strictEqual(reloadedContainer.kind, "container");
    assert.strictEqual(reloadedWreck.kind, "wreck");
    assert.strictEqual(reloadedContainer.isEmpty, true, "Reloaded container should retain empty state");
    assert.strictEqual(reloadedWreck.isEmpty, false, "Reloaded wreck should retain non-empty state");

    console.log(JSON.stringify({
      ok: true,
      characterID,
      containerItemID,
      wreckItemID,
      reloadedKinds: [reloadedContainer.kind, reloadedWreck.kind],
      reloadedEmptyStates: {
        container: reloadedContainer.isEmpty,
        wreck: reloadedWreck.isEmpty,
      },
    }, null, 2));
  } finally {
    runtime.detachSession(nearSession, { broadcast: false });
    runtime.detachSession(farSession, { broadcast: false });
    runtime._testing.clearScenes();
    if (containerItemID) {
      deleteItemCascade(containerItemID);
    }
    if (wreckItemID) {
      deleteItemCascade(wreckItemID);
    }
  }
}

main();
