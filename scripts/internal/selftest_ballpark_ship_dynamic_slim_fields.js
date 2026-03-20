const assert = require("assert");
const path = require("path");

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const {
  getCharacterRecord,
  updateCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  buildInventoryItem,
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

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function getListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function pickCharacterWithShip() {
  const charactersResult = database.read("characters", "/");
  assert(
    charactersResult && charactersResult.success,
    "Failed to read characters table",
  );

  for (const [characterID] of Object.entries(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    if (numericCharacterID <= 0) {
      continue;
    }
    const characterRecord = getCharacterRecord(numericCharacterID);
    const activeShip = getActiveShipRecord(numericCharacterID);
    if (!characterRecord || !activeShip) {
      continue;
    }

    return {
      characterID: numericCharacterID,
      characterRecord,
      activeShip,
    };
  }

  return null;
}

function getNextTemporaryItemID() {
  const itemsResult = database.read("items", "/");
  assert(itemsResult && itemsResult.success, "Failed to read items table");
  let maxItemID = 0;
  for (const itemID of Object.keys(itemsResult.data || {})) {
    const numericItemID = Number(itemID) || 0;
    if (numericItemID > maxItemID) {
      maxItemID = numericItemID;
    }
  }
  return maxItemID + 1000;
}

function buildSession(characterID, characterRecord, activeShip) {
  return {
    clientID: characterID + 5000,
    characterID,
    characterName: characterRecord.characterName || `char-${characterID}`,
    shipName: activeShip.itemName || "Ship",
    corporationID: Number(characterRecord.corporationID) || 0,
    allianceID: Number(characterRecord.allianceID) || 0,
    warFactionID: Number(characterRecord.factionID) || 0,
  };
}

function main() {
  const candidate = pickCharacterWithShip();
  assert(candidate, "No character with an active ship was found");

  const moduleType = resolveItemByName("Warp Disruptor I");
  assert(moduleType && moduleType.success, "Failed to resolve test module type");

  const originalCharacterRecord = getCharacterRecord(candidate.characterID);
  assert(originalCharacterRecord, "Original character record missing");

  const temporaryModuleItemID = getNextTemporaryItemID();
  const temporaryModule = buildInventoryItem({
    itemID: temporaryModuleItemID,
    typeID: moduleType.match.typeID,
    ownerID: candidate.characterID,
    locationID: candidate.activeShip.itemID,
    flagID: 27,
    itemName: moduleType.match.name,
    singleton: 1,
  });

  try {
    const moduleWriteResult = database.write(
      "items",
      `/${temporaryModuleItemID}`,
      temporaryModule,
    );
    assert(
      moduleWriteResult && moduleWriteResult.success,
      "Failed to write temporary fitted module item",
    );

    const firstSecurityStatus = 3.6;
    const firstBounty = 424242;
    const firstCharacterUpdate = updateCharacterRecord(
      candidate.characterID,
      (currentRecord) => ({
        ...currentRecord,
        securityStatus: firstSecurityStatus,
        securityRating: firstSecurityStatus,
        bounty: firstBounty,
      }),
    );
    assert(
      firstCharacterUpdate && firstCharacterUpdate.success,
      "Failed to update character presentation fields",
    );

    const entity = runtime._testing.buildShipEntityForTesting(
      buildSession(
        candidate.characterID,
        getCharacterRecord(candidate.characterID),
        candidate.activeShip,
      ),
      candidate.activeShip,
      Number(
        candidate.activeShip.spaceState &&
          candidate.activeShip.spaceState.systemID,
      ) || Number(getCharacterRecord(candidate.characterID).solarSystemID) || 30000142,
    );
    assert(entity, "Ship entity build failed");
    assert.strictEqual(entity.securityStatus, firstSecurityStatus);
    assert.strictEqual(entity.bounty, firstBounty);
    assert(
      Array.isArray(entity.modules) &&
        entity.modules.some(
          (entry) =>
            Array.isArray(entry) &&
            entry[0] === temporaryModuleItemID &&
            entry[1] === moduleType.match.typeID &&
            entry[2] === 27,
        ),
      "Ship entity should expose fitted modules from live inventory",
    );

    const initialSlim = destiny.buildSlimItemDict(entity);
    assert.strictEqual(
      getDictValue(initialSlim, "securityStatus"),
      firstSecurityStatus,
      "Slim securityStatus should come from the live character record",
    );
    assert.strictEqual(
      getDictValue(initialSlim, "bounty"),
      firstBounty,
      "Slim bounty should come from the live character record",
    );
    const initialModules = getListItems(getDictValue(initialSlim, "modules"));
    assert(
      initialModules.some(
        (entry) =>
          Array.isArray(entry) &&
          entry[0] === temporaryModuleItemID &&
          entry[1] === moduleType.match.typeID &&
          entry[2] === 27,
      ),
      "Slim modules should include the fitted module tuple",
    );

    const secondSecurityStatus = -1.25;
    const secondBounty = 999999;
    const secondCharacterUpdate = updateCharacterRecord(
      candidate.characterID,
      (currentRecord) => ({
        ...currentRecord,
        securityStatus: secondSecurityStatus,
        securityRating: secondSecurityStatus,
        bounty: secondBounty,
      }),
    );
    assert(
      secondCharacterUpdate && secondCharacterUpdate.success,
      "Failed to update character presentation fields for refresh test",
    );
    const removeResult = database.remove("items", `/${temporaryModuleItemID}`);
    assert(
      removeResult && removeResult.success,
      "Failed to remove temporary fitted module item",
    );

    runtime._testing.refreshShipPresentationFieldsForTesting(entity);
    const refreshedSlim = destiny.buildSlimItemDict(entity);
    assert.strictEqual(
      getDictValue(refreshedSlim, "securityStatus"),
      secondSecurityStatus,
      "Refresh path should re-read securityStatus from the character record",
    );
    assert.strictEqual(
      getDictValue(refreshedSlim, "bounty"),
      secondBounty,
      "Refresh path should re-read bounty from the character record",
    );
    const refreshedModules = getListItems(getDictValue(refreshedSlim, "modules"));
    assert(
      !refreshedModules.some(
        (entry) => Array.isArray(entry) && entry[0] === temporaryModuleItemID,
      ),
      "Refresh path should drop removed fitted modules",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          characterID: candidate.characterID,
          shipID: candidate.activeShip.itemID,
          temporaryModuleItemID,
          moduleTypeID: moduleType.match.typeID,
          initialSecurityStatus: firstSecurityStatus,
          refreshedSecurityStatus: secondSecurityStatus,
          initialBounty: firstBounty,
          refreshedBounty: secondBounty,
          initialModuleCount: initialModules.length,
          refreshedModuleCount: refreshedModules.length,
        },
        null,
        2,
      ),
    );
  } finally {
    updateCharacterRecord(candidate.characterID, originalCharacterRecord);
    database.remove("items", `/${temporaryModuleItemID}`);
  }
}

main();
