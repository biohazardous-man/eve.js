const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemTypeRegistry"));
const {
  createSpaceItemForCharacter,
  findItemById,
  grantItemToCharacterLocation,
  pruneExpiredSpaceItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));

const TEST_SYSTEM_ID = 30000142;
const TEST_CHARACTER_ID = 140000001;

function main() {
  const cargoContainer = resolveItemByName("Cargo Container");
  const tritanium = resolveItemByName("Tritanium");
  assert(cargoContainer.success, "Expected Cargo Container type");
  assert(tritanium.success, "Expected Tritanium type");

  let expiredItemID = null;
  let tickingItemID = null;

  try {
    const expiredCreate = createSpaceItemForCharacter(
      TEST_CHARACTER_ID,
      TEST_SYSTEM_ID,
      cargoContainer.match,
      {
        itemName: "Expired Test Container",
        position: { x: 10_000, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        createdAtMs: Date.now() - 10_000,
        expiresAtMs: Date.now() - 1_000,
      },
    );
    assert.strictEqual(expiredCreate.success, true);
    expiredItemID = Number(expiredCreate.data.itemID);
    assert.strictEqual(
      grantItemToCharacterLocation(
        TEST_CHARACTER_ID,
        expiredItemID,
        4,
        tritanium.match,
        5,
      ).success,
      true,
    );

    runtime._testing.clearScenes();
    const sceneWithoutPrune = runtime.ensureScene(TEST_SYSTEM_ID);
    assert.strictEqual(
      sceneWithoutPrune.getEntityByID(expiredItemID),
      null,
      "Expired debris should not load into a fresh scene",
    );

    const pruneResult = pruneExpiredSpaceItems(Date.now());
    assert.strictEqual(pruneResult.success, true);
    assert(
      (pruneResult.data.removedTopLevelItemIDs || []).includes(expiredItemID),
      "Expected expired top-level debris to be pruned from storage",
    );
    assert.strictEqual(findItemById(expiredItemID), null);

    const tickingCreate = createSpaceItemForCharacter(
      TEST_CHARACTER_ID,
      TEST_SYSTEM_ID,
      cargoContainer.match,
      {
        itemName: "Tick Expiry Container",
        position: { x: 12_000, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        createdAtMs: Date.now() - 1_000,
        expiresAtMs: Date.now() + 60_000,
      },
    );
    assert.strictEqual(tickingCreate.success, true);
    tickingItemID = Number(tickingCreate.data.itemID);
    assert.strictEqual(
      grantItemToCharacterLocation(
        TEST_CHARACTER_ID,
        tickingItemID,
        4,
        tritanium.match,
        5,
      ).success,
      true,
    );

    const spawnResult = runtime.spawnDynamicInventoryEntity(TEST_SYSTEM_ID, tickingItemID);
    assert.strictEqual(spawnResult.success, true);
    const liveScene = runtime.ensureScene(TEST_SYSTEM_ID);
    const entity = liveScene.getEntityByID(tickingItemID);
    assert(entity, "Expected ticking debris to be live in the scene");

    entity.expiresAtMs = Date.now() - 1;
    const destroyedIDs = liveScene.destroyExpiredInventoryBackedEntities(Date.now());
    assert(
      destroyedIDs.includes(tickingItemID),
      "Expected live expired debris to be removed during expiry sweep",
    );
    assert.strictEqual(liveScene.getEntityByID(tickingItemID), null);
    assert.strictEqual(findItemById(tickingItemID), null);

    console.log(JSON.stringify({
      ok: true,
      expiredPrunedItemID: expiredItemID,
      tickExpiredItemID: tickingItemID,
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    if (expiredItemID && findItemById(expiredItemID)) {
      removeInventoryItem(expiredItemID, { removeContents: true });
    }
    if (tickingItemID && findItemById(tickingItemID)) {
      removeInventoryItem(tickingItemID, { removeContents: true });
    }
  }
}

main();
