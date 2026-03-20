const path = require("path");

const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../../services/_shared/referenceData"));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));

const EXCLUDED_GROUP_NAMES = new Set([
  "wreck",
]);

let cachedGenericLootPool = null;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function chooseRandomEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  return entries[Math.floor(Math.random() * entries.length)] || null;
}

function getGenericLootPool() {
  if (cachedGenericLootPool) {
    return cachedGenericLootPool;
  }

  cachedGenericLootPool = readStaticRows(TABLE.ITEM_TYPES)
    .filter((entry) => (
      entry &&
      toPositiveInt(entry.typeID, 0) > 0 &&
      String(entry.name || "").trim().length > 0 &&
      entry.published !== false &&
      !EXCLUDED_GROUP_NAMES.has(String(entry.groupName || "").trim().toLowerCase())
    ));

  return cachedGenericLootPool;
}

function isLikelyStackable(itemType) {
  const categoryID = toPositiveInt(itemType && itemType.categoryID, 0);
  return categoryID === 4 || categoryID === 5 || categoryID === 8;
}

function seedNpcShipLoot(characterID, shipID, lootTable = null, options = {}) {
  const pool = getGenericLootPool();
  if (!lootTable || pool.length === 0) {
    return {
      success: true,
      data: {
        lootEntries: [],
        changes: [],
      },
    };
  }

  const minEntries = toPositiveInt(lootTable.minEntries, 1);
  const maxEntries = Math.max(minEntries, toPositiveInt(lootTable.maxEntries, minEntries));
  const entryCount = minEntries + Math.floor(Math.random() * ((maxEntries - minEntries) + 1));
  const lootEntries = [];
  const changes = [];

  for (let index = 0; index < entryCount; index += 1) {
    const itemType = chooseRandomEntry(pool);
    if (!itemType) {
      continue;
    }

    const stackableMinQuantity = toPositiveInt(lootTable.stackableMinQuantity, 1);
    const stackableMaxQuantity = Math.max(
      stackableMinQuantity,
      toPositiveInt(lootTable.stackableMaxQuantity, stackableMinQuantity),
    );
    const quantity = isLikelyStackable(itemType)
      ? stackableMinQuantity +
        Math.floor(Math.random() * ((stackableMaxQuantity - stackableMinQuantity) + 1))
      : 1;
    const grantResult = grantItemToCharacterLocation(
      characterID,
      shipID,
      ITEM_FLAGS.CARGO_HOLD,
      itemType,
      quantity,
      {
        singleton: !isLikelyStackable(itemType),
        transient: options.transient === true,
      },
    );
    if (!grantResult.success) {
      continue;
    }

    lootEntries.push({
      typeID: itemType.typeID,
      name: itemType.name,
      quantity,
    });
    changes.push(...((grantResult.data && grantResult.data.changes) || []));
  }

  return {
    success: true,
    data: {
      lootEntries,
      changes,
    },
  };
}

module.exports = {
  seedNpcShipLoot,
};
